import { downloadKittenModel } from '@/lib/tts/kittenDownload'
import type { KittenPreload } from '@/lib/tts/kittenEngine'
import { preloadOrtWasm } from '@/lib/tts/ortPreload'
import {
  fetchKittenManifest,
  hashKittenManifest,
  loadCachedKittenModel,
  loadLatestCachedKittenModel,
  saveCachedKittenModel,
} from '@/lib/tts/kittenModelCache'
import { isCrossOriginIsolated } from '@/lib/tts/kittenPlatform'
import { getPreferredVoice, resolveVoiceForEngine } from '@/lib/preferences'
import { syncVoiceWithEngineVoices } from '@/lib/tts/voiceSync'
import {
  activateBrowserEngine,
  areBrowserVoicesWarmed,
  browserTtsSupported,
} from '@/lib/tts/browserSpeech'
import { audioScheduler } from '@/lib/audio/scheduler'
import { usePlayerStore, type ModelLoadPhase, type ModelLoadStatus } from '@/stores/playerStore'
import { toast } from 'sonner'

const KITTEN_MODEL_ID = 'KittenML/kitten-tts-micro-0.8'

function isConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof mem === 'number' && mem <= 4) return true
  if (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4) {
    return true
  }
  return false
}

const CONSTRAINED_DEVICE = isConstrainedDevice()
const FIRST_STREAM_WINDOW = CONSTRAINED_DEVICE ? 4 : 6
const CONTINUE_STREAM_WINDOW = CONSTRAINED_DEVICE ? 4 : 6
const MAX_BUFFERED_AHEAD_SEC = CONSTRAINED_DEVICE ? 6 : 10
const RESUME_BUFFER_THRESHOLD_SEC = CONSTRAINED_DEVICE ? 4 : 7
const ENGINE_BYTES = 58 * 1024 * 1024
const DOWNLOAD_WATCHDOG_MS = 180_000
const COMPILE_WATCHDOG_MS = 120_000
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
let loadGeneration = 0
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

const SYNTH_CACHE_MAX = CONSTRAINED_DEVICE ? 32 : 96
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
  loadGeneration++
  if (engine) {
    engine.dispose()
  }
  loadInFlight = false
  loading = false
  loaded = false
  streamContext = null
  warmupSent = false
  engine = null
  engineModulePromise = null
  streamEpoch++
  prefetchEpoch++
  usePlayerStore.getState().setModelLoadPhase('idle')
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
  phase?: ModelLoadPhase,
  generation = loadGeneration,
): void {
  const store = getStore()
  if (store.modelStatus === 'error' || generation !== loadGeneration) return

  const safeTotal = total > 0 ? total : 1
  const pct = Math.min(100, Math.round((loadedBytes / safeTotal) * 100))
  store.setModelLoading(true, pct, {
    loadedBytes,
    totalBytes: total,
    status,
    phase: phase ?? (status === 'cached' ? 'downloading' : undefined),
  })
  if (status === 'cached') {
    usePlayerStore.setState({ modelFromCache: true })
  }
}

function applyError(message: string): void {
  console.error('[TTS]', message)
  loadGeneration++
  clearLoadWatchdog()
  if (engine) {
    engine.dispose()
  }
  loadInFlight = false
  loading = false
  loaded = false
  engine = null
  engineModulePromise = null
  getStore().setEngineReady(false)

  const keepPlayback =
    areBrowserVoicesWarmed() && browserTtsSupported() && getStore().engine !== 'browser'
  if (keepPlayback) {
    usePlayerStore.setState({
      isModelLoading: false,
      isModelReady: true,
      engineReady: true,
      modelStatus: 'error',
      modelLoadPhase: 'error',
      modelError: message,
    })
    return
  }

  getStore().setModelError(message)
}

function scheduleLoadWatchdog(timeoutMs: number, message: string, generation: number): void {
  clearLoadWatchdog()
  loadWatchdog = setTimeout(() => {
    if (generation !== loadGeneration) return
    applyError(message)
  }, timeoutMs)
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

async function waitForBufferHeadroom(epoch: number, streamId: number): Promise<boolean> {
  // Always yield at least one animation frame between sentences so UI/highlight stays smooth
  await new Promise((resolve) => setTimeout(resolve, CONSTRAINED_DEVICE ? 24 : 16))
  if (epoch !== streamEpoch || acceptedStreamId !== streamId) return false

  if (audioScheduler.getBufferedAheadSeconds() > MAX_BUFFERED_AHEAD_SEC) {
    while (
      audioScheduler.getBufferedAheadSeconds() > RESUME_BUFFER_THRESHOLD_SEC &&
      epoch === streamEpoch &&
      acceptedStreamId === streamId
    ) {
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  }
  return epoch === streamEpoch && acceptedStreamId === streamId
}

async function runStreamWindow(): Promise<void> {
  if (!streamContext || !engine) return
  const { chunks, voice, speed, nextIndex, streamId, windowSize } = streamContext
  if (nextIndex >= chunks.length) {
    streamContext = null
    return
  }

  const endIndex = Math.min(nextIndex + windowSize, chunks.length)
  const epoch = streamEpoch
  let index = nextIndex

  // Yield any consecutive cached chunks immediately
  while (index < endIndex) {
    const text = chunks[index]?.trim() ?? ''
    const key = text ? synthCacheKey(voice, speed, text) : ''
    const cached = key ? synthCache.get(key) : undefined
    if (!cached) break

    if (epoch !== streamEpoch || acceptedStreamId !== streamId) return

    await Promise.resolve(
      onChunkRef?.({
        text: cached.text,
        pcm: cached.pcm,
        sampleRate: cached.sampleRate,
        sentenceIndex: index,
      }),
    )
    index++
  }

  if (index >= endIndex || epoch !== streamEpoch || acceptedStreamId !== streamId) {
    if (epoch !== streamEpoch || acceptedStreamId !== streamId || !streamContext) return
    streamContext.nextIndex = index
    streamContext.windowSize = CONTINUE_STREAM_WINDOW
    if (streamContext.nextIndex < streamContext.chunks.length) {
      enqueueStreamWindow()
    } else {
      streamContext = null
    }
    return
  }

  while (index < endIndex) {
    if (epoch !== streamEpoch || acceptedStreamId !== streamId) break
    if (index > nextIndex || audioScheduler.getBufferedAheadSeconds() > 0.5) {
      const canContinue = await waitForBufferHeadroom(epoch, streamId)
      if (!canContinue) break
    }

    const sentenceText = chunks[index]
    if (!sentenceText?.trim()) {
      index++
      continue
    }

    const cached = synthCache.get(synthCacheKey(voice, speed, sentenceText.trim()))
    if (cached) {
      await Promise.resolve(
        onChunkRef?.({
          text: cached.text,
          pcm: cached.pcm,
          sampleRate: cached.sampleRate,
          sentenceIndex: index,
        }),
      )
      index++
      continue
    }

    try {
      for await (const chunk of engine.stream([sentenceText], {
        voice,
        speed,
        shouldAbort: () => epoch !== streamEpoch || acceptedStreamId !== streamId,
      })) {
        if (epoch !== streamEpoch || acceptedStreamId !== streamId) break
        if (chunk.pcm.length === 0) continue

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
      }
    } catch (err) {
      if (epoch !== streamEpoch || acceptedStreamId !== streamId) break
      console.warn('[TTS] Skipping sentence after synthesis error:', err)
    }
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
      console.warn('[TTS] Stream window interrupted:', err)
    })
  })()
}

function enqueuePrefetch(text: string, voice: string, speed: number): void {
  const key = synthCacheKey(voice, speed, text)
  const myEpoch = ++prefetchEpoch
  prefetchTail = prefetchTail
    .then(async () => {
      if (!engine || !loaded || acceptedStreamId !== -1) {
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
          shouldAbort: () =>
            acceptedStreamId !== -1 || streamEpoch !== epochAtStart || myEpoch !== prefetchEpoch,
        })) {
          if (
            acceptedStreamId !== -1 ||
            streamEpoch !== epochAtStart ||
            myEpoch !== prefetchEpoch
          ) {
            break
          }
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

async function resolveKittenPreload(generation: number): Promise<KittenPreload> {
  applyProgress(0, ENGINE_BYTES, 'downloading', 'downloading', generation)
  scheduleLoadWatchdog(
    DOWNLOAD_WATCHDOG_MS,
    'Voice model download timed out. Please retry.',
    generation,
  )

  const ortWarm = preloadOrtWasm()
  let manifest
  try {
    manifest = await fetchKittenManifest()
  } catch (err) {
    const offlineCached = await loadLatestCachedKittenModel()
    if (offlineCached && generation === loadGeneration) {
      await ortWarm
      usePlayerStore.setState({ modelFromCache: true })
      applyProgress(ENGINE_BYTES, ENGINE_BYTES, 'cached', 'downloading', generation)
      clearLoadWatchdog()
      return offlineCached.preload
    }
    throw err
  }

  if (generation !== loadGeneration) {
    throw new Error('Voice engine load aborted')
  }

  const manifestHash = await hashKittenManifest(manifest)
  const cached = await loadCachedKittenModel(manifestHash)
  if (cached && generation === loadGeneration) {
    await ortWarm
    const totalSize = Object.values(manifest.files).reduce((acc, f) => acc + f.size, 0)
    usePlayerStore.setState({ modelFromCache: true })
    applyProgress(totalSize, totalSize, 'cached', 'downloading', generation)
    clearLoadWatchdog()
    return cached
  }

  const result = await downloadKittenModel(
    KITTEN_MODEL_ID,
    (progress) => {
      applyProgress(progress.loaded, progress.total, progress.status, 'downloading', generation)
    },
    manifest,
  )

  if (generation !== loadGeneration) {
    throw new Error('Voice engine load aborted')
  }

  await ortWarm

  const preload: KittenPreload = {
    modelBuffer: result.modelBuffer,
    voicesBuffer: result.voicesBuffer,
    config: result.config,
  }
  void saveCachedKittenModel(manifestHash, preload)
  clearLoadWatchdog()
  return preload
}

function kittenBuffersUsable(preload: KittenPreload): boolean {
  return preload.modelBuffer.byteLength > 0 && preload.voicesBuffer.byteLength > 0
}

async function startLoad(preload: KittenPreload, generation: number): Promise<void> {
  const kittenEngine = await getEngine()
  if (generation !== loadGeneration) return

  try {
    await kittenEngine.load(
      (progress) => {
        applyProgress(
          progress.loaded,
          progress.total,
          progress.status ?? 'downloading',
          'compiling',
          generation,
        )
      },
      preload,
      {
        shouldAbort: () => generation !== loadGeneration,
        onCompiling: () => {
          if (generation !== loadGeneration) return
          getStore().setModelLoadPhase('compiling')
          scheduleLoadWatchdog(
            COMPILE_WATCHDOG_MS,
            'Voice engine preparation timed out. Please retry.',
            generation,
          )
        },
        onStage: (stage) => {
          if (generation !== loadGeneration) return
          getStore().setModelCompileStage(stage)
        },
      },
    )
  } catch (err) {
    if (generation !== loadGeneration) return
    if (err instanceof Error && err.message === 'Voice engine load aborted') return
    throw err
  }

  if (generation !== loadGeneration) return

  clearLoadWatchdog()
  kittenPreload = null
  loaded = true
  loading = false
  loadInFlight = false
  getStore().setEngineReady(true)
  applyProgress(ENGINE_BYTES, ENGINE_BYTES, 'ready', 'ready', generation)
  syncVoiceWithEngineVoices(kittenEngine.listVoices())
  usePlayerStore.setState({
    engine: 'kitten',
    voice: getPreferredVoice('kitten'),
  })
  getStore().setModelReady(true)
  toast.success('Neural voice ready')
  runWarmup()
}

export function getLoadingEngine(): 'kitten' | null {
  return loadInFlight ? 'kitten' : null
}

export function usesBrowserPlayback(): boolean {
  const store = getStore()
  if (store.engine === 'browser') return true
  return !isEngineReady() && areBrowserVoicesWarmed() && browserTtsSupported()
}

export function isPlaybackReady(): boolean {
  const store = getStore()
  if (usesBrowserPlayback()) {
    return areBrowserVoicesWarmed() && browserTtsSupported() && store.isModelReady
  }
  return isEngineReady()
}

export function abortKittenLoad(): void {
  loadGeneration++
  clearLoadWatchdog()
  if (engine) {
    engine.dispose()
  }
  loadInFlight = false
  loading = false
  loaded = false
  loadPromise = null
  kittenPreload = null
  engine = null
  engineModulePromise = null
  warmupSent = false
  streamEpoch++
  prefetchEpoch++
  usePlayerStore.setState({
    isModelLoading: false,
    modelLoadPhase: 'idle',
    modelCompileStage: null,
    modelError: null,
    modelProgress: 0,
    modelLoadedBytes: 0,
    modelTotalBytes: 0,
    modelStatus: 'idle',
  })
  void activateBrowserEngine()
}

let loadPromise: Promise<void> | null = null

export function prepareKittenInBackground(): void {
  if (loaded && engine) return
  if (loadPromise) return
  loadPromise = prepareKittenInBackgroundWork()
  void loadPromise.finally(() => {
    loadPromise = null
  })
}

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

async function prepareKittenInBackgroundWork(): Promise<void> {
  if (loadInFlight && loaded) return

  if (!isCrossOriginIsolated()) {
    console.info('[TTS] Cross-origin isolation unavailable; using browser speech engine.')
    void activateBrowserEngine()
    return
  }

  loading = true
  loadInFlight = true

  const token = ++switchToken
  const generation = ++loadGeneration

  usePlayerStore.setState({
    isModelLoading: true,
    modelError: null,
    modelFromCache: false,
    modelProgress: 0,
    modelCompileStage: null,
    modelLoadPhase: 'downloading',
  })

  if (areBrowserVoicesWarmed() && browserTtsSupported()) {
    usePlayerStore.setState({
      isModelReady: true,
      engineReady: true,
      modelStatus: 'ready',
    })
  }

  applyProgress(0, ENGINE_BYTES, 'downloading', 'downloading', generation)

  if (loaded && engine) {
    loadInFlight = false
    loading = false
    syncVoiceWithEngineVoices(engine.listVoices())
    getStore().setModelReady(true)
    return
  }

  try {
    if (!kittenPreload || !kittenBuffersUsable(kittenPreload)) {
      kittenPreload = await resolveKittenPreload(generation)
    } else {
      usePlayerStore.setState({ modelFromCache: true })
      applyProgress(ENGINE_BYTES, ENGINE_BYTES, 'cached', 'downloading', generation)
    }

    if (token !== switchToken || generation !== loadGeneration) {
    loading = false
    loadInFlight = false
    return
    }

    await startLoad(kittenPreload, generation)
  } catch (err) {
    if (token !== switchToken || generation !== loadGeneration) {
    loading = false
    loadInFlight = false
    return
    }
    loading = false
    const message = err instanceof Error ? err.message : 'Failed to download voice model'
    if (message !== 'Voice engine load aborted') {
      applyError(message)
    }
  }
}

async function switchEngineWork(): Promise<void> {
  if (loadInFlight && loaded) return

  if (!isCrossOriginIsolated()) {
    toast.info('Cross-origin isolation is not supported in this browser. Using system browser voices.')
    void activateBrowserEngine()
    return
  }

  const startingCold = !loaded && !loading
  if (startingCold) {
    loading = true
    loadInFlight = true
  }

  const token = ++switchToken
  const generation = ++loadGeneration
  stopTtsStream()

  usePlayerStore.setState({
    engine: 'kitten',
    isModelReady: false,
    isModelLoading: true,
    modelError: null,
    modelFromCache: false,
    modelProgress: 0,
    modelCompileStage: null,
    modelLoadPhase: 'downloading',
    voice: getPreferredVoice(),
    voices: [],
  })
  applyProgress(0, ENGINE_BYTES, 'downloading', 'downloading', generation)

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
      kittenPreload = await resolveKittenPreload(generation)
    } else {
      usePlayerStore.setState({ modelFromCache: true })
      applyProgress(ENGINE_BYTES, ENGINE_BYTES, 'cached', 'downloading', generation)
    }

    if (token !== switchToken || generation !== loadGeneration) {
      if (startingCold) {
        loading = false
        loadInFlight = false
      }
      return
    }

    await startLoad(kittenPreload, generation)
  } catch (err) {
    if (token !== switchToken || generation !== loadGeneration) {
      if (startingCold) {
        loading = false
        loadInFlight = false
      }
      return
    }
    loading = false
    const message = err instanceof Error ? err.message : 'Failed to download voice model'
    if (message !== 'Voice engine load aborted') {
      applyError(message)
    }
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
  streamEpoch++
  engine?.abort()
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
  engine?.abort()
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
