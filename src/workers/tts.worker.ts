import type { TtsEngine } from '@/lib/tts/engine'
import type { KittenEngine, KittenPreload } from '@/lib/tts/kittenEngine'

const DEFAULT_WINDOW_SIZE = 3

type WorkerMessage =
  | {
      type: 'load'
      kittenPreload?: KittenPreload
    }
  | {
      type: 'stream'
      chunks: string[]
      voice: string
      speed: number
      startIndex: number
      windowSize?: number
      streamId: number
    }
  | { type: 'stop' }
  | { type: 'listVoices' }
  | { type: 'prefetch'; text: string; voice: string; speed: number; prefetchId: number }

type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number; status?: string }
  | {
      type: 'chunk'
      text: string
      pcm: Float32Array
      sampleRate: number
      sentenceIndex: number
      streamId: number
    }
  | { type: 'voices'; voices: Array<{ id: string; label: string }> }
  | { type: 'ready' }
  | { type: 'done'; streamId: number; nextIndex: number }
  | {
      type: 'prefetchChunk'
      prefetchId: number
      text: string
      pcm: Float32Array
      sampleRate: number
    }
  | { type: 'prefetchDone'; prefetchId: number }
  | { type: 'prefetchError'; prefetchId: number }
  | { type: 'error'; message: string }

let engine: TtsEngine | null = null
let streaming = false
let activeStreamId = 0
let streamEpoch = 0
let currentJob: Promise<void> = Promise.resolve()
const postFromWorker = ((self as unknown as { postMessage: unknown }).postMessage as (
  message: WorkerResponse,
  transfer?: Transferable[],
) => void).bind(self)

const STALE_JOB_HARD_STOP_MS = 200

let prefetchTail: Promise<void> = Promise.resolve()
let prefetchEpoch = 0

function enqueuePrefetchJob(msg: Extract<WorkerMessage, { type: 'prefetch' }>): void {
  const myEpoch = ++prefetchEpoch
  prefetchTail = prefetchTail
    .then(async () => {
      if (!engine) {
        post({ type: 'prefetchError', prefetchId: msg.prefetchId })
        return
      }
      if (myEpoch !== prefetchEpoch) {
        post({ type: 'prefetchDone', prefetchId: msg.prefetchId })
        return
      }
      const epochAtStart = streamEpoch
      try {
        for await (const chunk of engine.stream([msg.text], {
          voice: msg.voice,
          speed: msg.speed,
          shouldAbort: () =>
            streamEpoch !== epochAtStart || myEpoch !== prefetchEpoch,
        })) {
          if (streamEpoch !== epochAtStart || myEpoch !== prefetchEpoch) {
            post({ type: 'prefetchDone', prefetchId: msg.prefetchId })
            return
          }
          const pcm = chunk.pcm
          post(
            {
              type: 'prefetchChunk',
              prefetchId: msg.prefetchId,
              text: chunk.text,
              pcm,
              sampleRate: chunk.sampleRate,
            },
            [pcm.buffer],
          )
        }
        post({ type: 'prefetchDone', prefetchId: msg.prefetchId })
      } catch {
        post({ type: 'prefetchError', prefetchId: msg.prefetchId })
      }
    })
    .catch(() => undefined)
}

function enqueueStreamJob(msg: Extract<WorkerMessage, { type: 'stream' }>): void {
  streamEpoch++
  const epoch = streamEpoch
  const prior = currentJob
  currentJob = (async () => {
    await Promise.race([
      prior.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, STALE_JOB_HARD_STOP_MS)),
    ])
    if (epoch !== streamEpoch) return
    await runStreamJob(msg, epoch).catch((err) => {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : 'TTS stream error',
      })
    })
  })()
}

async function createEngine(): Promise<TtsEngine> {
  const { KittenEngine } = await import('@/lib/tts/kittenEngine')
  return new KittenEngine()
}

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer) {
    postFromWorker(msg, transfer)
  } else {
    postFromWorker(msg)
  }
}

async function runStreamJob(
  msg: Extract<WorkerMessage, { type: 'stream' }>,
  epoch: number,
): Promise<void> {
  if (!engine) {
    post({ type: 'error', message: 'Engine not loaded' })
    return
  }

  const streamId = msg.streamId
  streaming = true
  activeStreamId = streamId

  const windowSize = msg.windowSize ?? DEFAULT_WINDOW_SIZE
  const endIndex = Math.min(msg.startIndex + windowSize, msg.chunks.length)
  const windowChunks = msg.chunks.slice(msg.startIndex, endIndex)
  let index = msg.startIndex

  for await (const chunk of engine.stream(windowChunks, {
    voice: msg.voice,
    speed: msg.speed,
    shouldAbort: () => epoch !== streamEpoch,
  })) {
    if (!streaming || activeStreamId !== streamId || epoch !== streamEpoch) break
    const pcm = chunk.pcm
    post(
      {
        type: 'chunk',
        text: chunk.text,
        pcm,
        sampleRate: chunk.sampleRate,
        sentenceIndex: index,
        streamId,
      },
      [pcm.buffer],
    )
    index++
  }

  if (streaming && activeStreamId === streamId && epoch === streamEpoch) {
    post({ type: 'done', streamId, nextIndex: index })
  }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data

  if (msg.type === 'stop') {
    streaming = false
    activeStreamId = 0
    streamEpoch++
    prefetchEpoch++
    return
  }

  if (msg.type === 'stream') {
    enqueueStreamJob(msg)
    return
  }

  if (msg.type === 'prefetch') {
    enqueuePrefetchJob(msg)
    return
  }

  void (async () => {
    try {
      if (msg.type === 'load') {
        post({ type: 'progress', loaded: 5, total: 100, status: 'downloading' })
        engine = await createEngine()
        post({ type: 'progress', loaded: 25, total: 100, status: 'downloading' })

        if (!msg.kittenPreload) {
          post({ type: 'error', message: 'Voice model buffers missing — reload from Home page' })
          return
        }
        const ENGINE_LOAD_TIMEOUT_MS = 60_000
        const loadPromise = (engine as KittenEngine).load(
          (progress) => {
            post({ type: 'progress', ...progress, status: progress.status ?? 'downloading' })
          },
          msg.kittenPreload,
        )
        let timer: ReturnType<typeof setTimeout> | null = null
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Engine load timed out after ${ENGINE_LOAD_TIMEOUT_MS}ms`)),
            ENGINE_LOAD_TIMEOUT_MS,
          )
        })
        try {
          await Promise.race([loadPromise, timeoutPromise])
        } finally {
          if (timer) clearTimeout(timer)
        }

        post({ type: 'ready' })
        return
      }

      if (msg.type === 'listVoices') {
        post({
          type: 'voices',
          voices: engine?.listVoices() ?? [],
        })
      }
    } catch (err) {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : 'TTS worker error',
      })
    }
  })()
}
