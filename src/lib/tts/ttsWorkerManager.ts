import TtsWorker from '@/workers/tts.worker?worker'
import { downloadKittenModel } from '@/lib/tts/kittenDownload'
import {
  downloadPiperVoice,
  getCachedPiperPreload,
  type PiperPreload,
} from '@/lib/tts/piperDownload'
import { PIPER_DEFAULT_VOICE } from '@/lib/tts/piperVoices'
import { getPreferredVoice, resolveVoiceForEngine, savePreferences } from '@/lib/preferences'
import { resolveEngineType } from '@/lib/tts/deployment'
import { syncVoiceWithEngineVoices } from '@/lib/tts/voiceSync'
import { usePlayerStore, type ModelLoadStatus } from '@/stores/playerStore'
import type { TtsEngineType } from '@/lib/types'

const KITTEN_MODEL_ID = 'KittenML/kitten-tts-micro-0.8'
const FIRST_STREAM_WINDOW = 1
const CONTINUE_STREAM_WINDOW = 3

const ENGINE_BYTES: Record<TtsEngineType, number> = {
  kitten: 43 * 1024 * 1024,
  piper: 75 * 1024 * 1024,
}

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

type WorkerLoadMessage = {
  type: 'load'
  engineType: TtsEngineType
  kittenPreload?: KittenPreload
  piperPreload?: PiperPreload
  skipWarmup?: boolean
}

type StreamContext = {
  chunks: string[]
  voice: string
  speed: number
  nextIndex: number
  streamId: number
  windowSize: number
}

type EngineSlot = {
  worker: Worker
  loaded: boolean
  loading: boolean
}

const slots = new Map<TtsEngineType, EngineSlot>()
let activeEngine: TtsEngineType | null = null
let onChunkRef: ChunkHandler | null = null
let loadedEngine: TtsEngineType | null = null
let loadInFlight: TtsEngineType | null = null
let kittenPreload: KittenPreload | null = null
let currentStreamId = 0
let streamContext: StreamContext | null = null
let switchToken = 0
let prefetchId = 0
const prefetchInFlight = new Set<string>()
const sessionEnginesLoaded = new Set<TtsEngineType>()

type CachedChunk = {
  text: string
  pcm: Float32Array
  sampleRate: number
}

const SYNTH_CACHE_MAX = 96
const synthCache = new Map<string, CachedChunk>()

function synthCacheKey(
  engine: TtsEngineType,
  voice: string,
  speed: number,
  text: string,
): string {
  return `${engine}|${voice}|${speed}|${text}`
}

function rememberSynthChunk(
  engine: TtsEngineType,
  voice: string,
  speed: number,
  text: string,
  chunk: CachedChunk,
): void {
  if (!text.trim()) return
  const key = synthCacheKey(engine, voice, speed, text)
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
  loaded: number,
  total: number,
  status: ModelLoadStatus = 'downloading',
): void {
  const safeTotal = total > 0 ? total : 1
  const pct = Math.min(100, Math.round((loaded / safeTotal) * 100))
  getStore().setModelLoading(true, pct, {
    loadedBytes: loaded,
    totalBytes: total,
    status,
  })
  if (status === 'cached') {
    usePlayerStore.setState({ modelFromCache: true })
  }
}

function applyError(message: string): void {
  console.error('[TTS]', message)
  loadInFlight = null
  getStore().setModelError(message)
}

function getSlot(engineType: TtsEngineType): EngineSlot {
  let slot = slots.get(engineType)
  if (!slot) {
    const worker = new TtsWorker()
    slot = { worker, loaded: false, loading: false }
    worker.onmessage = (event) => handleSlotMessage(engineType, event)
    worker.onerror = (event) => {
      if (activeEngine === engineType || slot?.loading) {
        applyError(event.message || 'TTS worker failed')
      }
    }
    worker.onmessageerror = () => {
      if (activeEngine === engineType || slot?.loading) {
        applyError('TTS worker received an invalid message')
      }
    }
    slots.set(engineType, slot)
  }
  return slot
}

function getActiveWorker(): Worker | null {
  if (!activeEngine) return null
  return slots.get(activeEngine)?.worker ?? null
}

function postStreamWindow(): void {
  const worker = getActiveWorker()
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

function handleSlotMessage(engineType: TtsEngineType, event: MessageEvent): void {
  const data = event.data
  const slot = slots.get(engineType)
  const isActive = activeEngine === engineType

  switch (data.type) {
    case 'progress': {
      if (loadInFlight !== engineType && !isActive) break
      const status = (data.status ?? 'downloading') as ModelLoadStatus
      let loaded = data.loaded
      let total = data.total
      if (total > 0 && total <= 100 && loadInFlight) {
        const engineBytes = ENGINE_BYTES[loadInFlight]
        loaded = Math.round((loaded / total) * engineBytes)
        total = engineBytes
      }
      applyProgress(loaded, total, status)
      break
    }
    case 'ready':
      if (slot) {
        slot.loaded = true
        slot.loading = false
      }
      if (isActive) {
        loadedEngine = engineType
        loadInFlight = null
        slot?.worker.postMessage({ type: 'listVoices' })
      }
      break
    case 'voices': {
      if (!isActive) break
      syncVoiceWithEngineVoices(data.voices, loadedEngine)
      getStore().setModelReady(true)
      if (loadedEngine) sessionEnginesLoaded.add(loadedEngine)
      break
    }
    case 'prefetchChunk': {
      if (!isActive || !loadedEngine) break
      const ctx = streamContext
      const voice = ctx?.voice ?? getStore().voice
      const speed = ctx?.speed ?? getStore().speed
      rememberSynthChunk(loadedEngine, voice, speed, data.text, {
        text: data.text,
        pcm: data.pcm,
        sampleRate: data.sampleRate,
      })
      prefetchInFlight.delete(synthCacheKey(loadedEngine, voice, speed, data.text))
      break
    }
    case 'chunk':
      if (!isActive || data.streamId !== currentStreamId) break
      if (loadedEngine) {
        const ctx = streamContext
        if (ctx) {
          rememberSynthChunk(loadedEngine, ctx.voice, ctx.speed, data.text, {
            text: data.text,
            pcm: data.pcm,
            sampleRate: data.sampleRate,
          })
        }
      }
      void Promise.resolve(onChunkRef?.(data))
      break
    case 'done':
      if (!isActive || data.streamId !== currentStreamId || !streamContext) break
      streamContext.nextIndex = data.nextIndex
      streamContext.windowSize = CONTINUE_STREAM_WINDOW
      if (streamContext.nextIndex < streamContext.chunks.length) {
        postStreamWindow()
      } else {
        streamContext = null
      }
      break
    case 'error':
      if (slot?.loading) {
        slot.loading = false
        if (isActive) applyError(data.message)
      } else if (isActive) {
        console.warn('[TTS] playback error:', data.message)
      }
      break
  }
}

async function downloadKittenOnMainThread(): Promise<KittenPreload> {
  applyProgress(0, ENGINE_BYTES.kitten, 'downloading')

  const result = await downloadKittenModel(KITTEN_MODEL_ID, (progress) => {
    applyProgress(progress.loaded, progress.total, progress.status)
  })

  return {
    modelBuffer: result.modelBuffer,
    voicesBuffer: result.voicesBuffer,
    config: result.config,
  }
}

async function downloadPiperOnMainThread(voiceId: string): Promise<PiperPreload> {
  applyProgress(0, ENGINE_BYTES.piper, 'downloading')
  const voiceWeight = 0.4

  return downloadPiperVoice(voiceId, (loaded, total) => {
    const safeTotal = total > 0 ? total : ENGINE_BYTES.piper
    const scaledLoaded = Math.round((loaded / safeTotal) * ENGINE_BYTES.piper * voiceWeight)
    const scaledTotal = ENGINE_BYTES.piper
    applyProgress(
      scaledLoaded,
      scaledTotal,
      loaded >= safeTotal ? 'downloading' : 'downloading',
    )
  })
}

function kittenBuffersUsable(preload: KittenPreload): boolean {
  return preload.modelBuffer.byteLength > 0 && preload.voicesBuffer.byteLength > 0
}

async function startSlotLoad(
  engineType: TtsEngineType,
  options?: {
    kittenPreload?: KittenPreload
    piperPreload?: PiperPreload
    skipWarmup?: boolean
  },
): Promise<void> {
  const message: WorkerLoadMessage = { type: 'load', engineType }
  const transfer: Transferable[] = []

  if (engineType === 'kitten' && options?.kittenPreload) {
    const modelCopy = options.kittenPreload.modelBuffer.slice(0)
    const voicesCopy = options.kittenPreload.voicesBuffer.slice(0)
    message.kittenPreload = {
      modelBuffer: modelCopy,
      voicesBuffer: voicesCopy,
      config: options.kittenPreload.config,
    }
    transfer.push(modelCopy, voicesCopy)
  }

  if (engineType === 'piper' && options?.piperPreload) {
    const onnxCopy = options.piperPreload.onnxBuffer.slice(0)
    message.piperPreload = {
      ...options.piperPreload,
      onnxBuffer: onnxCopy,
    }
    message.skipWarmup = options.skipWarmup
    transfer.push(onnxCopy)
  }

  getSlot(engineType).worker.postMessage(message, transfer)
}

export function getLoadingEngine(): TtsEngineType | null {
  return loadInFlight
}

const engineLoadPromises = new Map<TtsEngineType, Promise<void>>()

export async function switchEngine(engineType: TtsEngineType): Promise<void> {
  const resolved = resolveEngineType(engineType)
  if (resolved !== engineType) {
    return switchEngine(resolved)
  }

  const slot = getSlot(engineType)

  if (
    activeEngine === engineType &&
    slot.loaded &&
    loadedEngine === engineType &&
    getStore().isModelReady
  ) {
    return
  }

  const existing = engineLoadPromises.get(engineType)
  if (existing) {
    activeEngine = engineType
    savePreferences({ engine: engineType })
    await existing
    return
  }

  const work = switchEngineWork(engineType)
  engineLoadPromises.set(engineType, work)
  try {
    await work
  } finally {
    engineLoadPromises.delete(engineType)
  }
}

async function switchEngineWork(engineType: TtsEngineType): Promise<void> {
  const slot = getSlot(engineType)

  const startingCold = !slot.loaded && !slot.loading
  if (startingCold) {
    slot.loading = true
    loadInFlight = engineType
  }

  const token = ++switchToken
  stopTtsStream()

  activeEngine = engineType
  savePreferences({ engine: engineType })

  if (slot.loaded) {
    if (loadedEngine === engineType && getStore().isModelReady) {
      return
    }
    loadedEngine = engineType
    loadInFlight = null
    usePlayerStore.setState({
      isModelReady: false,
      isModelLoading: false,
      modelError: null,
      modelFromCache: true,
      modelProgress: 100,
      engine: engineType,
      voice: getPreferredVoice(engineType),
      voices: [],
    })
    slot.worker.postMessage({ type: 'listVoices' })
    return
  }

  if (slot.loading && !startingCold) {
    return
  }
  loadedEngine = null

  usePlayerStore.setState({
    isModelReady: false,
    isModelLoading: true,
    modelError: null,
    modelFromCache: false,
    modelProgress: 0,
    engine: engineType,
    voice: getPreferredVoice(engineType),
    voices: [],
  })
  applyProgress(0, ENGINE_BYTES[engineType], 'downloading')

  try {
    if (engineType === 'kitten') {
      if (!kittenPreload || !kittenBuffersUsable(kittenPreload)) {
        kittenPreload = await downloadKittenOnMainThread()
      } else {
        usePlayerStore.setState({ modelFromCache: true })
        applyProgress(ENGINE_BYTES.kitten, ENGINE_BYTES.kitten, 'cached')
      }
      if (token !== switchToken) {
        if (startingCold) slot.loading = false
        return
      }
      await startSlotLoad(engineType, { kittenPreload })
      return
    }

    if (engineType === 'piper') {
      const voiceId = getPreferredVoice('piper') || PIPER_DEFAULT_VOICE
      const cached = getCachedPiperPreload(voiceId)
      const voiceReadyBytes = Math.floor(ENGINE_BYTES.piper * 0.4)
      if (cached) {
        usePlayerStore.setState({ modelFromCache: true })
        applyProgress(voiceReadyBytes, ENGINE_BYTES.piper, 'cached')
      }
      const piperPreload = cached ?? (await downloadPiperOnMainThread(voiceId))
      if (token !== switchToken) {
        if (startingCold) slot.loading = false
        return
      }
      applyProgress(voiceReadyBytes, ENGINE_BYTES.piper, 'downloading')
      await startSlotLoad(engineType, {
        piperPreload,
        skipWarmup: true,
      })
      return
    }

    if (sessionEnginesLoaded.has(engineType)) {
      usePlayerStore.setState({ modelFromCache: true })
      applyProgress(ENGINE_BYTES[engineType], ENGINE_BYTES[engineType], 'cached')
    }

    if (token !== switchToken) {
      if (startingCold) slot.loading = false
      return
    }
    await startSlotLoad(engineType)
  } catch (err) {
    if (token !== switchToken) {
      if (startingCold) slot.loading = false
      return
    }
    slot.loading = false
    applyError(err instanceof Error ? err.message : 'Failed to download voice model')
  }
}

/** @deprecated Use switchEngine */
export const preloadEngine = switchEngine

/** @deprecated Use switchEngine */
export const reloadEngine = switchEngine

export function isEngineReady(engineType?: TtsEngineType): boolean {
  const store = getStore()
  const target = engineType ?? store.engine
  const slot = slots.get(target)
  if (slot?.loaded && loadedEngine === target) {
    return true
  }
  if (!store.isModelReady) return false
  if (engineType && loadedEngine !== engineType) return false
  return true
}

export function prefetchSynthTexts(texts: string[]): void {
  const store = getStore()
  if (!loadedEngine || !store.isModelReady) return

  const worker = getActiveWorker()
  if (!worker) return

  const voice = resolveVoiceForEngine(store.voices, store.engine, store.voice)
  const speed = store.speed
  const engine = store.engine

  for (const text of texts) {
    const trimmed = text?.trim()
    if (!trimmed) continue
    const key = synthCacheKey(engine, voice, speed, trimmed)
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
  const worker = getActiveWorker()
  if (worker) {
    worker.postMessage({ type: 'stop' })
  }
}

export async function startTtsStream(
  chunks: string[],
  startIndex: number,
  voice: string,
  speed: number,
  onChunk: ChunkHandler,
): Promise<void> {
  const store = getStore()
  const resolvedVoice = resolveVoiceForEngine(store.voices, store.engine, voice)
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

  const engine = store.engine
  let nextIndex = startIndex
  const startText = chunks[startIndex]
  if (startText?.trim() && loadedEngine) {
    const cached = synthCache.get(synthCacheKey(engine, voice, speed, startText))
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
