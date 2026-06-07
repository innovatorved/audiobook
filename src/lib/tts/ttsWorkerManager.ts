import TtsWorker from '@/workers/tts.worker?worker'
import { downloadKittenModel } from '@/lib/tts/kittenDownload'
import { getPreferredVoice, resolveVoiceForEngine, savePreferences } from '@/lib/preferences'
import { syncVoiceWithEngineVoices } from '@/lib/tts/voiceSync'
import { usePlayerStore, type ModelLoadStatus } from '@/stores/playerStore'

const KITTEN_MODEL_ID = 'KittenML/kitten-tts-micro-0.8'
const FIRST_STREAM_WINDOW = 1
const CONTINUE_STREAM_WINDOW = 4
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
let acceptedStreamId = -1
let streamContext: StreamContext | null = null
let switchToken = 0
let prefetchId = 0
let loadWatchdog: ReturnType<typeof setTimeout> | null = null
const prefetchInFlight = new Set<string>()
const prefetchById = new Map<
  number,
  { key: string; voice: string; speed: number; text: string }
>()

const WARMUP_STREAM_ID = -9999
let warmupSent = false

type CachedChunk = {
  text: string
  pcm: Float32Array
  sampleRate: number
}

const SYNTH_CACHE_MAX = 96
const MAX_PREFETCH_IN_FLIGHT = 1
let backgroundPrefetchEnabled = false
const synthCache = new Map<string, CachedChunk>()

function synthCacheKey(voice: string, speed: number, text: string): string {
  return `kitten|${voice}|${speed}|${text}`
}

async function waitForSynthCache(
  voice: string,
  speed: number,
  text: string,
  maxMs = 100,
): Promise<CachedChunk | undefined> {
  const key = synthCacheKey(voice, speed, text)
  const existing = synthCache.get(key)
  if (existing) return existing
  if (!prefetchInFlight.has(key)) return undefined

  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 40))
    const hit = synthCache.get(key)
    if (hit) return hit
    if (!prefetchInFlight.has(key)) break
  }
  return synthCache.get(key)
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

export function unloadTtsEngine(): void {
  clearLoadWatchdog()
  loadInFlight = false
  loading = false
  loaded = false
  streamContext = null
  warmupSent = false
  worker?.terminate()
  worker = null
}

function getStore() {
  return usePlayerStore.getState()
}

function clearLoadWatchdog(): void {
  if (loadWatchdog) {
    clearTimeout(loadWatchdog)
    loadWatchdog = null
  }
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
  clearLoadWatchdog()
  loadInFlight = false
  loading = false
  loaded = false
  worker?.terminate()
  worker = null
  getStore().setEngineReady(false)
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
      clearLoadWatchdog()
      loaded = true
      loading = false
      loadInFlight = false
      getStore().setEngineReady(true)
      applyProgress(ENGINE_BYTES, ENGINE_BYTES, 'ready')
      getStore().setModelReady(true)
      break
    case 'voices':
      syncVoiceWithEngineVoices(data.voices)
      getStore().setModelReady(true)
      if (!warmupSent && worker) {
        warmupSent = true
        const store = getStore()
        const voice = resolveVoiceForEngine(store.voices, store.voice)
        worker.postMessage({
          type: 'stream',
          chunks: ['Hello.'],
          voice,
          speed: store.speed,
          startIndex: 0,
          windowSize: 1,
          streamId: WARMUP_STREAM_ID,
        })
      }
      break
    case 'prefetchChunk': {
      const meta = prefetchById.get(data.prefetchId)
      const voice = meta?.voice ?? getStore().voice
      const speed = meta?.speed ?? getStore().speed
      const text = meta?.text ?? data.text
      rememberSynthChunk(voice, speed, data.text, {
        text: data.text,
        pcm: data.pcm,
        sampleRate: data.sampleRate,
      })
      prefetchInFlight.delete(meta?.key ?? synthCacheKey(voice, speed, text))
      prefetchById.delete(data.prefetchId)
      break
    }
    case 'prefetchDone':
    case 'prefetchError': {
      const meta = prefetchById.get(data.prefetchId)
      if (meta) {
        prefetchInFlight.delete(meta.key)
        prefetchById.delete(data.prefetchId)
      }
      break
    }
    case 'chunk':
      if (data.streamId === WARMUP_STREAM_ID) {
        break
      }
      if (data.streamId !== acceptedStreamId) {
        break
      }
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
      if (data.streamId !== acceptedStreamId || !streamContext) break
      streamContext.nextIndex = data.nextIndex
      streamContext.windowSize = CONTINUE_STREAM_WINDOW
      if (streamContext.nextIndex < streamContext.chunks.length) {
        postStreamWindow()
      } else {
        streamContext = null
      }
      break
    case 'error':
      applyError(data.message ?? 'TTS worker error')
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
  clearLoadWatchdog()
  loadWatchdog = setTimeout(() => {
    applyError('Voice engine preparation timed out. Please retry.')
  }, 35_000)
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
  if (loaded && worker) {
    const store = getStore()
    if (!store.isModelReady) {
      getWorker().postMessage({ type: 'listVoices' })
    }
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

export function isEngineReady(): boolean {
  return loaded && !!worker && getStore().engineReady && getStore().isModelReady
}

export function setBackgroundPrefetchEnabled(enabled: boolean): void {
  backgroundPrefetchEnabled = enabled
}

export function peekSynthCache(text: string): CachedChunk | undefined {
  const store = getStore()
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const voice = resolveVoiceForEngine(store.voices, store.voice)
  return synthCache.get(synthCacheKey(voice, store.speed, trimmed))
}

export function isSynthWarming(text: string): boolean {
  const store = getStore()
  const trimmed = text.trim()
  if (!trimmed) return false
  const voice = resolveVoiceForEngine(store.voices, store.voice)
  return prefetchInFlight.has(synthCacheKey(voice, store.speed, trimmed))
}

export function warmSynthText(text: string): void {
  prefetchSynthTexts([text])
}

export function interruptPlaybackOnly(): void {
  acceptedStreamId = -1
  streamContext = null
}

export function prefetchSynthTexts(texts: string[]): void {
  if (!backgroundPrefetchEnabled) return
  if (!loaded || !worker) return
  const store = getStore()
  const voice = resolveVoiceForEngine(store.voices, store.voice)
  const speed = store.speed
  for (const raw of texts) {
    if (prefetchInFlight.size >= MAX_PREFETCH_IN_FLIGHT) return
    const trimmed = raw?.trim()
    if (!trimmed) continue
    const key = synthCacheKey(voice, speed, trimmed)
    if (synthCache.has(key) || prefetchInFlight.has(key)) continue
    prefetchInFlight.add(key)
    prefetchId++
    prefetchById.set(prefetchId, { key, voice, speed, text: trimmed })
    worker.postMessage({
      type: 'prefetch',
      text: trimmed,
      voice,
      speed,
      prefetchId,
    })
  }
}

function assignStreamId(): number {
  currentStreamId++
  acceptedStreamId = currentStreamId
  return acceptedStreamId
}

export function stopTtsStream(): void {
  acceptedStreamId = -1
  streamContext = null
  prefetchInFlight.clear()
  prefetchById.clear()
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
  if (!loaded || !worker) {
    throw new Error('TTS engine is not loaded')
  }

  const resolvedVoice = resolveVoiceForEngine(store.voices, voice)
  if (resolvedVoice !== voice) {
    store.setVoice(resolvedVoice)
    voice = resolvedVoice
  }

  if (startIndex >= chunks.length) {
    streamContext = null
    return
  }

  const startText = chunks[startIndex]?.trim() ?? ''
  const cacheKey = startText ? synthCacheKey(voice, speed, startText) : ''

  onChunkRef = onChunk
  streamContext = null

  let cached = cacheKey ? synthCache.get(cacheKey) : undefined
  if (!cached && cacheKey && prefetchInFlight.has(cacheKey)) {
    cached = await waitForSynthCache(voice, speed, startText)
  }
  let nextIndex = startIndex
  if (cached) {
    await onChunk({
      text: cached.text,
      pcm: cached.pcm,
      sampleRate: cached.sampleRate,
      sentenceIndex: startIndex,
    })
    nextIndex = startIndex + 1
  }

  if (nextIndex >= chunks.length) {
    streamContext = null
    return
  }

  const streamId = assignStreamId()
  streamContext = {
    chunks,
    voice,
    speed,
    nextIndex,
    streamId,
    windowSize: chunks.length === 1 ? 1 : FIRST_STREAM_WINDOW,
  }
  postStreamWindow()
}

