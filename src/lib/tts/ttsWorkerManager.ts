import TtsWorker from '@/workers/tts.worker?worker'
import { downloadKittenModel } from '@/lib/tts/kittenDownload'
import { getPreferredVoice, resolveVoiceForEngine, savePreferences } from '@/lib/preferences'
import { syncVoiceWithEngineVoices } from '@/lib/tts/voiceSync'
import { usePlayerStore, type ModelLoadStatus } from '@/stores/playerStore'

const KITTEN_MODEL_ID = 'KittenML/kitten-tts-micro-0.8'
const FIRST_STREAM_WINDOW = 1
const CONTINUE_STREAM_WINDOW = 3
const ENGINE_BYTES = 43 * 1024 * 1024

type ChunkHandler = (chunk: {
  text: string
  pcm: Float32Array
  sampleRate: number
  sentenceIndex: number
}) => void | Promise<void>

type KittenPreload = {
  modelBuffer: ArrayBuffer
  voicesBuffer: ArrayBuffer
  config: Record<string, unknown>
}

type StreamContext = {
  chunks: string[]
  voice: string
  speed: number
  nextIndex: number
  streamId: number
  windowSize: number
}

let worker: Worker | null = null
let loaded = false
let loading = false
let onChunkRef: ChunkHandler | null = null
let loadInFlight = false
let kittenPreload: KittenPreload | null = null
let currentStreamId = 0
let streamContext: StreamContext | null = null
let switchToken = 0
let prefetchId = 0
const prefetchInFlight = new Set<string>()

type CachedChunk = {
  text: string
  pcm: Float32Array
  sampleRate: number
}

const SYNTH_CACHE_MAX = 96
const synthCache = new Map<string, CachedChunk>()

function synthCacheKey(voice: string, speed: number, text: string): string {
  return `kitten|${voice}|${speed}|${text}`
}

function rememberSynthChunk(
  voice: string,
  speed: number,
  text: string,
  chunk: CachedChunk,
): void {
  if (!text.trim()) return
  const key = synthCacheKey(voice, speed, text)
  if (synthCache.has(key)) {
    synthCache.delete(key)
  }
  synthCache.set(key, chunk)
  while (synthCache.size > SYNTH_CACHE_MAX) {
    const oldest = synthCache.keys().next().value
    if (oldest === undefined) break
    synthCache.delete(oldest)
  }
}

export function clearSynthCache(): void {
  synthCache.clear()
}

function getStore() {
  return usePlayerStore.getState()
}

function applyProgress(
  loadedBytes: number,
  total: number,
  status: ModelLoadStatus = 'downloading',
): void {
  const safeTotal = total > 0 ? total : 1
  const pct = Math.min(100, Math.round((loadedBytes / safeTotal) * 100))
  getStore().setModelLoading(true, pct, {
    loadedBytes,
    totalBytes: total,
    status,
  })
  if (status === 'cached') {
    usePlayerStore.setState({ modelFromCache: true })
  }
}

function applyError(message: string): void {
  console.error('[TTS]', message)
  loadInFlight = false
  loading = false
  getStore().setModelError(message)
}

function getWorker(): Worker {
  if (!worker) {
    worker = new TtsWorker()
    worker.onmessage = handleWorkerMessage
    worker.onerror = (event) => {
      if (loadInFlight || loading) {
        applyError(event.message || 'TTS worker failed')
      }
    }
    worker.onmessageerror = () => {
      if (loadInFlight || loading) {
        applyError('TTS worker received an invalid message')
      }
    }
  }
  return worker
}

function postStreamWindow(): void {
  if (!streamContext || !worker) return
  const { chunks, voice, speed, nextIndex, streamId, windowSize } = streamContext
  if (nextIndex >= chunks.length) {
    streamContext = null
    return
  }

  worker.postMessage({
    type: 'stream',
    chunks,
    voice,
    speed,
    startIndex: nextIndex,
    windowSize,
    streamId,
  })
}

function handleWorkerMessage(event: MessageEvent): void {
  const data = event.data

  switch (data.type) {
    case 'progress': {
      if (!loadInFlight) break
      const status = (data.status ?? 'downloading') as ModelLoadStatus
      let loadedBytes = data.loaded
      let total = data.total
      if (total > 0 && total <= 100) {
        loadedBytes = Math.round((loadedBytes / total) * ENGINE_BYTES)
        total = ENGINE_BYTES
      }
      applyProgress(loadedBytes, total, status)
      break
    }
    case 'ready':
      loaded = true
      loading = false
      loadInFlight = false
      getWorker().postMessage({ type: 'listVoices' })
      break
    case 'voices':
      syncVoiceWithEngineVoices(data.voices)
      getStore().setModelReady(true)
      break
    case 'prefetchChunk': {
      const ctx = streamContext
      const voice = ctx?.voice ?? getStore().voice
      const speed = ctx?.speed ?? getStore().speed
      rememberSynthChunk(voice, speed, data.text, {
        text: data.text,
        pcm: data.pcm,
        sampleRate: data.sampleRate,
      })
      prefetchInFlight.delete(synthCacheKey(voice, speed, data.text))
      break
    }
    case 'chunk':
      if (data.streamId !== currentStreamId) break
      if (streamContext) {
        const { voice, speed } = streamContext
        rememberSynthChunk(voice, speed, data.text, {
          text: data.text,
          pcm: data.pcm,
          sampleRate: data.sampleRate,
        })
      }
      void Promise.resolve(onChunkRef?.(data))
      break
    case 'done':
      if (data.streamId !== currentStreamId || !streamContext) break
      streamContext.nextIndex = data.nextIndex
      streamContext.windowSize = CONTINUE_STREAM_WINDOW
      if (streamContext.nextIndex < streamContext.chunks.length) {
        postStreamWindow()
      } else {
        streamContext = null
      }
      break
    case 'error':
      if (loading) {
        loading = false
        applyError(data.message)
      } else {
        console.warn('[TTS] playback error:', data.message)
      }
      break
  }
}

async function downloadKittenOnMainThread(): Promise<KittenPreload> {
  applyProgress(0, ENGINE_BYTES, 'downloading')

  const result = await downloadKittenModel(KITTEN_MODEL_ID, (progress) => {
    applyProgress(progress.loaded, progress.total, progress.status)
  })

  return {
    modelBuffer: result.modelBuffer,
    voicesBuffer: result.voicesBuffer,
    config: result.config,
  }
}

function kittenBuffersUsable(preload: KittenPreload): boolean {
  return preload.modelBuffer.byteLength > 0 && preload.voicesBuffer.byteLength > 0
}

async function startLoad(preload: KittenPreload): Promise<void> {
  const modelCopy = preload.modelBuffer.slice(0)
  const voicesCopy = preload.voicesBuffer.slice(0)
  getWorker().postMessage(
    {
      type: 'load',
      kittenPreload: {
        modelBuffer: modelCopy,
        voicesBuffer: voicesCopy,
        config: preload.config,
      },
    },
    [modelCopy, voicesCopy],
  )
}

export function getLoadingEngine(): 'kitten' | null {
  return loadInFlight ? 'kitten' : null
}

let loadPromise: Promise<void> | null = null

export async function switchEngine(_engineType: 'kitten' = 'kitten'): Promise<void> {
  if (loaded && getStore().isModelReady) {
    return
  }

  if (loadPromise) {
    await loadPromise
    return
  }

  loadPromise = switchEngineWork()
  try {
    await loadPromise
  } finally {
    loadPromise = null
  }
}

async function switchEngineWork(): Promise<void> {
  const startingCold = !loaded && !loading
  if (startingCold) {
    loading = true
    loadInFlight = true
  }

  const token = ++switchToken
  stopTtsStream()

  usePlayerStore.setState({
    engine: 'kitten',
    isModelReady: false,
    isModelLoading: true,
    modelError: null,
    modelFromCache: false,
    modelProgress: 0,
    voice: getPreferredVoice(),
    voices: [],
  })
  applyProgress(0, ENGINE_BYTES, 'downloading')

  if (loaded) {
    loadInFlight = false
    usePlayerStore.setState({
      isModelReady: false,
      isModelLoading: false,
      modelError: null,
      modelFromCache: true,
      modelProgress: 100,
    })
    getWorker().postMessage({ type: 'listVoices' })
    return
  }

  try {
    if (!kittenPreload || !kittenBuffersUsable(kittenPreload)) {
      kittenPreload = await downloadKittenOnMainThread()
    } else {
      usePlayerStore.setState({ modelFromCache: true })
      applyProgress(ENGINE_BYTES, ENGINE_BYTES, 'cached')
    }

    if (token !== switchToken) {
      if (startingCold) loading = false
      return
    }

    await startLoad(kittenPreload)
  } catch (err) {
    if (token !== switchToken) {
      if (startingCold) loading = false
      return
    }
    loading = false
    applyError(err instanceof Error ? err.message : 'Failed to download voice model')
  }
}

/** @deprecated Use switchEngine */
export const preloadEngine = switchEngine

/** @deprecated Use switchEngine */
export const reloadEngine = switchEngine

export function isEngineReady(): boolean {
  const store = getStore()
  if (loaded) return true
  return store.isModelReady
}

export function prefetchSynthTexts(texts: string[]): void {
  const store = getStore()
  if (!loaded || !store.isModelReady || !worker) return

  const voice = resolveVoiceForEngine(store.voices, store.voice)
  const speed = store.speed

  for (const text of texts) {
    const trimmed = text?.trim()
    if (!trimmed) continue
    const key = synthCacheKey(voice, speed, trimmed)
    if (synthCache.has(key) || prefetchInFlight.has(key)) continue
    prefetchInFlight.add(key)
    worker.postMessage({
      type: 'prefetch',
      text: trimmed,
      voice,
      speed,
      prefetchId: ++prefetchId,
    })
  }
}

export function stopTtsStream(): void {
  currentStreamId++
  streamContext = null
  prefetchInFlight.clear()
  worker?.postMessage({ type: 'stop' })
}

export async function startTtsStream(
  chunks: string[],
  startIndex: number,
  voice: string,
  speed: number,
  onChunk: ChunkHandler,
): Promise<void> {
  const store = getStore()
  const resolvedVoice = resolveVoiceForEngine(store.voices, voice)
  if (resolvedVoice !== voice) {
    store.setVoice(resolvedVoice)
    voice = resolvedVoice
  }

  stopTtsStream()
  currentStreamId++
  const streamId = currentStreamId
  onChunkRef = onChunk

  if (startIndex >= chunks.length) {
    streamContext = null
    return
  }

  let nextIndex = startIndex
  const startText = chunks[startIndex]
  if (startText?.trim()) {
    const cached = synthCache.get(synthCacheKey(voice, speed, startText))
    if (cached) {
      await onChunk({
        text: cached.text,
        pcm: cached.pcm,
        sampleRate: cached.sampleRate,
        sentenceIndex: startIndex,
      })
      nextIndex = startIndex + 1
    }
  }

  if (nextIndex >= chunks.length) {
    streamContext = null
    return
  }

  streamContext = {
    chunks,
    voice,
    speed,
    nextIndex,
    streamId,
    windowSize: FIRST_STREAM_WINDOW,
  }
  postStreamWindow()
}
