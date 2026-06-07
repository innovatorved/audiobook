import type { TtsEngine } from '@/lib/tts/engine'
import type { PiperEngine } from '@/lib/tts/piperEngine'
import type { PiperPreload } from '@/lib/tts/piperDownload'
import type { TtsEngineType } from '@/lib/types'
import type { KittenEngine, KittenPreload } from '@/lib/tts/kittenEngine'

const DEFAULT_WINDOW_SIZE = 3

type WorkerMessage =
  | {
      type: 'load'
      engineType: TtsEngineType
      kittenPreload?: KittenPreload
      piperPreload?: PiperPreload
      skipWarmup?: boolean
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
  | { type: 'error'; message: string }

let engine: TtsEngine | null = null
let streaming = false
let activeStreamId = 0
let streamEpoch = 0
let synthChain: Promise<void> = Promise.resolve()

function runSynthExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = synthChain.then(fn, fn)
  synthChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function createEngine(type: TtsEngineType): Promise<TtsEngine> {
  switch (type) {
    case 'piper': {
      const { PiperEngine } = await import('@/lib/tts/engines/piper')
      return new PiperEngine()
    }
    case 'kitten':
    default: {
      const { KittenEngine } = await import('@/lib/tts/kittenEngine')
      return new KittenEngine()
    }
  }
}

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer) {
    self.postMessage(msg, transfer)
  } else {
    self.postMessage(msg)
  }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data

  if (msg.type === 'stop') {
    streaming = false
    activeStreamId = 0
    streamEpoch++
    return
  }

  if (msg.type === 'stream') {
    streamEpoch++
  }

  const run =
    msg.type === 'stream' || msg.type === 'prefetch'
      ? runSynthExclusive
      : <T>(fn: () => Promise<T>) => fn()

  void run(async () => {
  try {
    if (msg.type === 'load') {
      post({ type: 'progress', loaded: 5, total: 100, status: 'downloading' })
      engine = await createEngine(msg.engineType)
      post({ type: 'progress', loaded: 25, total: 100, status: 'downloading' })

      if (msg.engineType === 'kitten') {
        if (!msg.kittenPreload) {
          post({ type: 'error', message: 'Kitten model buffers missing — reload from Home page' })
          return
        }
        await (engine as KittenEngine).load(
          (progress) => {
            post({ type: 'progress', ...progress, status: progress.status ?? 'downloading' })
          },
          msg.kittenPreload,
        )
      } else if (msg.engineType === 'piper') {
        if (!msg.piperPreload) {
          post({ type: 'error', message: 'Piper voice buffers missing — reload from Home page' })
          return
        }
        await (engine as PiperEngine).load(
          (progress) => {
            post({ type: 'progress', ...progress, status: progress.status ?? 'downloading' })
          },
          { preload: msg.piperPreload, skipWarmup: msg.skipWarmup },
        )
      } else {
        await engine.load((progress) => {
          post({ type: 'progress', ...progress, status: progress.status ?? 'downloading' })
        })
      }

      post({ type: 'ready' })
      return
    }

    if (msg.type === 'listVoices') {
      post({
        type: 'voices',
        voices: engine?.listVoices() ?? [],
      })
      return
    }

    if (msg.type === 'prefetch') {
      const epoch = streamEpoch
      if (!engine || streaming || !msg.text.trim() || epoch !== streamEpoch) return

      for await (const chunk of engine.stream([msg.text], {
        voice: msg.voice,
        speed: msg.speed,
      })) {
        if (streaming || epoch !== streamEpoch) break
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
        break
      }
      return
    }

    if (msg.type === 'stream') {
      if (!engine) {
        post({ type: 'error', message: 'Engine not loaded' })
        return
      }

      const streamId = msg.streamId
      const epoch = streamEpoch
      streaming = true
      activeStreamId = streamId

      const windowSize = msg.windowSize ?? DEFAULT_WINDOW_SIZE
      const endIndex = Math.min(msg.startIndex + windowSize, msg.chunks.length)
      const windowChunks = msg.chunks.slice(msg.startIndex, endIndex)
      let index = msg.startIndex

      for await (const chunk of engine.stream(windowChunks, {
        voice: msg.voice,
        speed: msg.speed,
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
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : 'TTS worker error',
    })
  }
  })
}
