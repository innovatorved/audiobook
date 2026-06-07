import TtsWorker from '@/workers/tts.worker?worker'
import { downloadKittenModel } from '@/lib/tts/kittenDownload'
import { usePlayerStore, type ModelLoadStatus } from '@/stores/playerStore'
import type { TtsEngineType } from '@/lib/types'

const KITTEN_MODEL_ID = 'KittenML/kitten-tts-micro-0.8'
const STREAM_WINDOW = 5

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
}

type StreamContext = {
  chunks: string[]
  voice: string
  speed: number
  nextIndex: number
  streamId: number
}

let worker: Worker | null = null
let onChunkRef: ChunkHandler | null = null
let loadedEngine: TtsEngineType | null = null
let loadInFlight: TtsEngineType | null = null
let kittenPreload: KittenPreload | null = null
let currentStreamId = 0
let streamContext: StreamContext | null = null
let prefetchId = 0

type CachedChunk = {
  text: string
  pcm: Float32Array
  sampleRate: number
}

const prefetchCache = new Map<string, CachedChunk>()
const pendingPrefetches = new Map<
  number,
  { sentenceIndex: number; voice: string; speed: number }
>()
const prefetchWaiters = new Map<string, Array<() => void>>()

function notifyPrefetchWaiters(key: string): void {
  const waiters = prefetchWaiters.get(key)
  if (!waiters) return
  prefetchWaiters.delete(key)
  for (const resolve of waiters) resolve()
}

function prefetchCacheKey(
  sentenceIndex: number,
  text: string,
  voice: string,
  speed: number,
): string {
  return `${voice}|${speed}|${sentenceIndex}|${text}`
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

function postStreamWindow(): void {
  if (!streamContext || !worker) return
  const { chunks, voice, speed, nextIndex, streamId } = streamContext
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
    windowSize: STREAM_WINDOW,
    streamId,
  })
}

function handleWorkerMessage(event: MessageEvent) {
  const data = event.data
  switch (data.type) {
    case 'progress': {
      const status = (data.status ?? 'downloading') as ModelLoadStatus
      applyProgress(data.loaded, data.total, status)
      break
    }
    case 'ready':
      loadedEngine = loadInFlight
      loadInFlight = null
      getStore().setModelReady(true)
      worker?.postMessage({ type: 'listVoices' })
      break
    case 'voices':
      getStore().setVoices(data.voices)
      break
    case 'prefetchReady': {
      const hadPending = pendingPrefetches.has(data.prefetchId)
      pendingPrefetches.delete(data.prefetchId)
      const sentenceIndex = data.sentenceIndex
      const voice = data.voice
      const speed = data.speed
      const key = prefetchCacheKey(sentenceIndex, data.text, voice, speed)
      prefetchCache.set(key, {
        text: data.text,
        pcm: data.pcm,
        sampleRate: data.sampleRate,
      })
      notifyPrefetchWaiters(key)
      // #region agent log
      fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'play-start-v3',location:'ttsWorkerManager.ts:prefetchReady',message:'prefetch cached',data:{sentenceIndex,voice,speed,textLen:data.text.length,hadPending},timestamp:Date.now(),hypothesisId:'prefetch'})}).catch(()=>{});
      // #endregion
      break
    }
    case 'chunk':
      if (data.streamId !== currentStreamId) break
      // #region agent log
      fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'play-start',location:'ttsWorkerManager.ts:chunk',message:'stream chunk received',data:{sentenceIndex:data.sentenceIndex,streamId:data.streamId,samples:data.pcm.length},timestamp:Date.now(),hypothesisId:'stream'})}).catch(()=>{});
      // #endregion
      void Promise.resolve(onChunkRef?.(data))
      break
    case 'done':
      if (data.streamId !== currentStreamId || !streamContext) break
      streamContext.nextIndex = data.nextIndex
      if (streamContext.nextIndex < streamContext.chunks.length) {
        postStreamWindow()
      } else {
        streamContext = null
      }
      break
    case 'error':
      applyError(data.message)
      break
  }
}

function ensureWorker(): Worker {
  if (!worker) {
    worker = new TtsWorker()
    worker.onmessage = handleWorkerMessage
    worker.onerror = (event) => {
      applyError(event.message || 'TTS worker failed to start')
    }
    worker.onmessageerror = () => {
      applyError('TTS worker received an invalid message')
    }

    if (loadedEngine === 'kitten' && kittenPreload) {
      void startWorkerLoad('kitten', kittenPreload)
    } else if (loadedEngine) {
      void startWorkerLoad(loadedEngine)
    }
  }
  return worker
}

async function downloadKittenOnMainThread(): Promise<KittenPreload> {
  applyProgress(0, 43 * 1024 * 1024, 'downloading')

  const result = await downloadKittenModel(KITTEN_MODEL_ID, (progress) => {
    applyProgress(progress.loaded, progress.total, progress.status)
  })

  return {
    modelBuffer: result.modelBuffer,
    voicesBuffer: result.voicesBuffer,
    config: result.config,
  }
}

async function startWorkerLoad(
  engineType: TtsEngineType,
  preload?: KittenPreload,
): Promise<void> {
  const message: WorkerLoadMessage = { type: 'load', engineType }
  const transfer: Transferable[] = []

  if (engineType === 'kitten' && preload) {
    message.kittenPreload = preload
    transfer.push(preload.modelBuffer, preload.voicesBuffer)
  }

  ensureWorker().postMessage(message, transfer)
}

export async function preloadEngine(engineType: TtsEngineType = 'kitten'): Promise<void> {
  const store = getStore()
  if (store.isModelReady && loadedEngine === engineType) return
  if (loadInFlight === engineType) return

  loadInFlight = engineType
  usePlayerStore.setState({ modelFromCache: false, modelError: null })
  store.setEngine(engineType)
  applyProgress(0, 43 * 1024 * 1024, 'downloading')

  try {
    if (engineType === 'kitten') {
      kittenPreload = await downloadKittenOnMainThread()
      await startWorkerLoad(engineType, kittenPreload)
      return
    }

    await startWorkerLoad(engineType)
  } catch (err) {
    applyError(err instanceof Error ? err.message : 'Failed to download voice model')
  }
}

export function reloadEngine(engineType: TtsEngineType): void {
  stopTtsStream()
  loadedEngine = null
  loadInFlight = null
  kittenPreload = null
  usePlayerStore.setState({ isModelReady: false, modelFromCache: false, modelError: null })
  void preloadEngine(engineType)
}

export function isEngineReady(engineType?: TtsEngineType): boolean {
  const store = getStore()
  if (!store.isModelReady) return false
  if (engineType && loadedEngine !== engineType) return false
  return true
}

export function stopTtsStream(): void {
  currentStreamId++
  streamContext = null
  if (worker) {
    worker.postMessage({ type: 'stop' })
  }
}

export function clearPrefetchCache(): void {
  prefetchCache.clear()
  pendingPrefetches.clear()
  prefetchWaiters.clear()
}

export function hasPrefetchedSentence(
  sentenceIndex: number,
  text: string,
  voice: string,
  speed: number,
): boolean {
  return prefetchCache.has(prefetchCacheKey(sentenceIndex, text, voice, speed))
}

function isPrefetchPending(
  sentenceIndex: number,
  voice: string,
  speed: number,
): boolean {
  for (const pending of pendingPrefetches.values()) {
    if (
      pending.sentenceIndex === sentenceIndex &&
      pending.voice === voice &&
      pending.speed === speed
    ) {
      return true
    }
  }
  return false
}

export function waitForPrefetch(
  sentenceIndex: number,
  text: string,
  voice: string,
  speed: number,
  timeoutMs = 12000,
): Promise<boolean> {
  const key = prefetchCacheKey(sentenceIndex, text, voice, speed)
  if (prefetchCache.has(key)) return Promise.resolve(true)

  if (!isPrefetchPending(sentenceIndex, voice, speed)) {
    prefetchSentence(sentenceIndex, text, voice, speed)
  }

  const waitStart = Date.now()
  return new Promise((resolve) => {
    const finish = (hit: boolean) => {
      // #region agent log
      fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'play-start-v3',location:'ttsWorkerManager.ts:waitForPrefetch',message:'prefetch wait done',data:{sentenceIndex,hit,waitMs:Date.now()-waitStart},timestamp:Date.now(),hypothesisId:'prefetch-wait'})}).catch(()=>{});
      // #endregion
      resolve(hit)
    }

    const timer = setTimeout(() => finish(prefetchCache.has(key)), timeoutMs)
    const onReady = () => {
      clearTimeout(timer)
      finish(true)
    }

    const waiters = prefetchWaiters.get(key) ?? []
    waiters.push(onReady)
    prefetchWaiters.set(key, waiters)
  })
}

export function prefetchSentence(
  sentenceIndex: number,
  text: string,
  voice: string,
  speed: number,
): void {
  if (!isEngineReady() || !text.trim()) return
  ensureWorker()

  const key = prefetchCacheKey(sentenceIndex, text, voice, speed)
  if (prefetchCache.has(key)) return

  if (isPrefetchPending(sentenceIndex, voice, speed)) return

  const id = ++prefetchId
  pendingPrefetches.set(id, { sentenceIndex, voice, speed })
  // #region agent log
  fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'play-start-v3',location:'ttsWorkerManager.ts:prefetchSentence',message:'prefetch requested',data:{sentenceIndex,voice,speed,textLen:text.length},timestamp:Date.now(),hypothesisId:'prefetch'})}).catch(()=>{});
  // #endregion
  worker.postMessage({
    type: 'prefetch',
    text,
    voice,
    speed,
    prefetchId: id,
    sentenceIndex,
  })
}

export async function startTtsStream(
  chunks: string[],
  startIndex: number,
  voice: string,
  speed: number,
  onChunk: ChunkHandler,
): Promise<void> {
  const startText = chunks[startIndex]
  if (startText) {
    const cacheKey = prefetchCacheKey(startIndex, startText, voice, speed)
    if (!prefetchCache.has(cacheKey)) {
      await waitForPrefetch(startIndex, startText, voice, speed)
    }
  }

  stopTtsStream()
  currentStreamId++
  const streamId = currentStreamId
  onChunkRef = onChunk

  let nextIndex = startIndex
  if (startText) {
    const cacheKey = prefetchCacheKey(startIndex, startText, voice, speed)
    const cached = prefetchCache.get(cacheKey)
    if (cached) {
      prefetchCache.delete(cacheKey)
      // #region agent log
      fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'play-start-v3',location:'ttsWorkerManager.ts:startTtsStream',message:'using prefetched first chunk',data:{sentenceIndex:startIndex,samples:cached.pcm.length},timestamp:Date.now(),hypothesisId:'prefetch-hit'})}).catch(()=>{});
      // #endregion
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

  streamContext = { chunks, voice, speed, nextIndex, streamId }
  postStreamWindow()
}
