import { downloadKittenModel } from '@/lib/tts/kittenDownload'
import type { KittenPreload } from '@/lib/tts/kittenEngine'
import { getPreferredVoice, resolveVoiceForEngine } from '@/lib/preferences'
import { syncVoiceWithEngineVoices } from '@/lib/tts/voiceSync'
import { usePlayerStore, type ModelLoadStatus } from '@/stores/playerStore'

const KITTEN_MODEL_ID = 'KittenML/kitten-tts-micro-0.8'
const FIRST_STREAM_WINDOW = 1
const CONTINUE_STREAM_WINDOW = 4
const ENGINE_BYTES = 43 * 1024 * 1024
const LOAD_WATCHDOG_MS = 95_000
const STALE_JOB_HARD_STOP_MS = 200

type ChunkHandler = (chunk: {
  text: string
  pcm: Float32Array
  sampleRate: number
  sentenceIndex: number
}) => void | Promise<void>

type StreamContext = {
  chunks: string[]
  voice: string
  speed: number
  nextIndex: number
  streamId: number
  windowSize: number
}

type KittenEngineInstance = InstanceType<
  Awaited<typeof import('@/lib/tts/kittenEngine')>['KittenEngine']
>

let engine: KittenEngineInstance | null = null
let engineModulePromise: Promise<typeof import('@/lib/tts/kittenEngine')> | null = null
let loaded = false
let loading = false
let onChunkRef: ChunkHandler | null = null
let loadInFlight = false
let kittenPreload: KittenPreload | null = null
let currentStreamId = 0
let acceptedStreamId = -1
let streamContext: StreamContext | null = null
let switchToken = 0
let streamEpoch = 0
let prefetchEpoch = 0
let loadWatchdog: ReturnType<typeof setTimeout> | null = null
let currentStreamJob: Promise<void> = Promise.resolve()
let prefetchTail: Promise<void> = Promise.resolve()
const prefetchInFlight = new Set<string>()

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
  engine = null
  streamEpoch++
  prefetchEpoch++
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
  engine = null
  getStore().setEngineReady(false)
  getStore().setModelError(message)
}

async function getEngine(): Promise<KittenEngineInstance> {
  if (!engine) {
    if (!engineModulePromise) {
      engineModulePromise = import('@/lib/tts/kittenEngine')
    }
    const mod = await engineModulePromise
    engine = new mod.KittenEngine()
  }
  return engine
}

function runWarmup(): void {
  if (warmupSent || !loaded || !engine) return
  warmupSent = true
  const store = getStore()
  const voice = resolveVoiceForEngine(store.voices, store.voice)
  void (async () => {
    try {
      for await (const _chunk of engine!.stream(['Hello.'], {
        voice,
        speed: store.speed,
      })) {
        break
      }
    } catch {
      // Warmup is best-effort.
    }
  })()
}

async function runStreamWindow(): Promise<void> {
  if (!streamContext || !engine) return
  const { chunks, voice, speed, nextIndex, streamId, windowSize } = streamContext
  if (nextIndex >= chunks.length) {
    streamContext = null
    return
  }

  const endIndex = Math.min(nextIndex + windowSize, chunks.length)
  const windowChunks = chunks.slice(nextIndex, endIndex)
  const epoch = streamEpoch
  let index = nextIndex

  for await (const chunk of engine.stream(windowChunks, {
    voice,
    speed,
    shouldAbort: () => epoch !== streamEpoch || acceptedStreamId !== streamId,
  })) {
    if (epoch !== streamEpoch || acceptedStreamId !== streamId) break

    rememberSynthChunk(voice, speed, chunk.text, {
      text: chunk.text,
      pcm: chunk.pcm,
      sampleRate: chunk.sampleRate,
    })

    await Promise.resolve(
      onChunkRef?.({
        text: chunk.text,
        pcm: chunk.pcm,
        sampleRate: chunk.sampleRate,
        sentenceIndex: index,
      }),
    )
    index++
  }

  if (epoch !== streamEpoch || acceptedStreamId !== streamId || !streamContext) return

  streamContext.nextIndex = index
  streamContext.windowSize = CONTINUE_STREAM_WINDOW
  if (streamContext.nextIndex < streamContext.chunks.length) {
    enqueueStreamWindow()
  } else {
    streamContext = null
  }
}

function enqueueStreamWindow(): void {
  const epoch = streamEpoch
  const prior = currentStreamJob
  currentStreamJob = (async () => {
    await Promise.race([
      prior.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, STALE_JOB_HARD_STOP_MS)),
    ])
    if (epoch !== streamEpoch) return
    await runStreamWindow().catch((err) => {
      applyError(err instanceof Error ? err.message : 'TTS stream error')
    })
  })()
}

function enqueuePrefetch(text: string, voice: string, speed: number): void {
  const key = synthCacheKey(voice, speed, text)
  const myEpoch = ++prefetchEpoch
  prefetchTail = prefetchTail
    .then(async () => {
      if (!engine || !loaded) {
        prefetchInFlight.delete(key)
        return
      }
      if (myEpoch !== prefetchEpoch) {
        prefetchInFlight.delete(key)
        return
      }
      const epochAtStart = streamEpoch
      try {
        for await (const chunk of engine.stream([text], {
          voice,
          speed,
          shouldAbort: () => streamEpoch !== epochAtStart || myEpoch !== prefetchEpoch,
        })) {
          if (streamEpoch !== epochAtStart || myEpoch !== prefetchEpoch) break
          rememberSynthChunk(voice, speed, chunk.text, {
            text: chunk.text,
            pcm: chunk.pcm,
            sampleRate: chunk.sampleRate,
          })
        }
      } catch {
        // Prefetch is best-effort.
      } finally {
        prefetchInFlight.delete(key)
      }
    })
    .catch(() => undefined)
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
  clearLoadWatchdog()
  loadWatchdog = setTimeout(() => {
    applyError('Voice engine preparation timed out. Please retry.')
  }, LOAD_WATCHDOG_MS)

  const kittenEngine = await getEngine()
  await kittenEngine.load(
    (progress) => {
      applyProgress(progress.loaded, progress.total, progress.status ?? 'downloading')
    },
    preload,
  )

  clearLoadWatchdog()
  loaded = true
  loading = false
  loadInFlight = false
  getStore().setEngineReady(true)
  applyProgress(ENGINE_BYTES, ENGINE_BYTES, 'ready')
  syncVoiceWithEngineVoices(kittenEngine.listVoices())
  getStore().setModelReady(true)
  runWarmup()
}

export function getLoadingEngine(): 'kitten' | null {
  return loadInFlight ? 'kitten' : null
}

let loadPromise: Promise<void> | null = null

export async function switchEngine(_engineType: 'kitten' = 'kitten'): Promise<void> {
  if (loaded && engine) {
    const store = getStore()
    if (!store.isModelReady) {
      syncVoiceWithEngineVoices(engine.listVoices())
      getStore().setModelReady(true)
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
  if (loadInFlight && loaded) return

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

  if (loaded && engine) {
    loadInFlight = false
    usePlayerStore.setState({
      isModelReady: false,
      isModelLoading: false,
      modelError: null,
      modelFromCache: true,
      modelProgress: 100,
    })
    syncVoiceWithEngineVoices(engine.listVoices())
    getStore().setModelReady(true)
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
      if (startingCold) {
        loading = false
        loadInFlight = false
      }
      return
    }

    await startLoad(kittenPreload)
  } catch (err) {
    if (token !== switchToken) {
      if (startingCold) {
        loading = false
        loadInFlight = false
      }
      return
    }
    loading = false
    applyError(err instanceof Error ? err.message : 'Failed to download voice model')
  }
}

export function isEngineReady(): boolean {
  return loaded && !!engine && getStore().engineReady && getStore().isModelReady
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
  if (!loaded || !engine) return
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
    enqueuePrefetch(trimmed, voice, speed)
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
  streamEpoch++
  prefetchEpoch++
  prefetchInFlight.clear()
}

export async function startTtsStream(
  chunks: string[],
  startIndex: number,
  voice: string,
  speed: number,
  onChunk: ChunkHandler,
): Promise<void> {
  const store = getStore()
  if (!loaded || !engine) {
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
  enqueueStreamWindow()
}
