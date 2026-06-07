import type { TtsEngine } from '@/lib/tts/engine'
import type { TtsEngineType } from '@/lib/types'
import type { KittenPreload } from '@/lib/tts/kittenEngine'

const DEFAULT_WINDOW_SIZE = 5

type WorkerMessage =
  | { type: 'load'; engineType: TtsEngineType; kittenPreload?: KittenPreload }
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
  | {
      type: 'prefetch'
      text: string
      voice: string
      speed: number
      prefetchId: number
      sentenceIndex: number
    }

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
      type: 'prefetchReady'
      prefetchId: number
      sentenceIndex: number
      text: string
      voice: string
      speed: number
      pcm: Float32Array
      sampleRate: number
    }
  | { type: 'error'; message: string }

let engine: TtsEngine | null = null
let streaming = false
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
    case 'kokoro': {
      const { KokoroEngine } = await import('@/lib/tts/kokoroEngine')
      return new KokoroEngine()
    }
    case 'piper': {
      const { PiperEngine } = await import('@/lib/tts/piperEngine')
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
    return
  }

  const run = msg.type === 'prefetch' || msg.type === 'stream'
    ? runSynthExclusive
    : <T>(fn: () => Promise<T>) => fn()

  void run(async () => {
  try {
    if (msg.type === 'load') {
      engine = await createEngine(msg.engineType)

      if (msg.engineType === 'kitten') {
        if (!msg.kittenPreload) {
          post({ type: 'error', message: 'Kitten model buffers missing — reload from Home page' })
          return
        }
        const { KittenEngine } = await import('@/lib/tts/kittenEngine')
        await (engine as InstanceType<typeof KittenEngine>).load(
          (progress) => {
            post({ type: 'progress', ...progress, status: progress.status ?? 'downloading' })
          },
          msg.kittenPreload,
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
      if (!engine) {
        post({ type: 'error', message: 'Prefetch failed: engine not loaded' })
        return
      }

      const stream = engine.stream([msg.text], { voice: msg.voice, speed: msg.speed })
      const first = await stream.next()
      if (first.done || !first.value) {
        post({ type: 'error', message: 'Prefetch failed: empty synthesis result' })
        return
      }

      const pcm = first.value.pcm
      post(
        {
          type: 'prefetchReady',
          prefetchId: msg.prefetchId,
          sentenceIndex: msg.sentenceIndex,
          text: msg.text,
          voice: msg.voice,
          speed: msg.speed,
          pcm,
          sampleRate: first.value.sampleRate,
        },
        [pcm.buffer],
      )
      return
    }

    if (msg.type === 'stream') {
      if (!engine) {
        post({ type: 'error', message: 'Engine not loaded' })
        return
      }

      streaming = false
      streaming = true

      const windowSize = msg.windowSize ?? DEFAULT_WINDOW_SIZE
      const endIndex = Math.min(msg.startIndex + windowSize, msg.chunks.length)
      const windowChunks = msg.chunks.slice(msg.startIndex, endIndex)
      let index = msg.startIndex

      for await (const chunk of engine.stream(windowChunks, {
        voice: msg.voice,
        speed: msg.speed,
      })) {
        if (!streaming) break
        const pcm = chunk.pcm
        post(
          {
            type: 'chunk',
            text: chunk.text,
            pcm,
            sampleRate: chunk.sampleRate,
            sentenceIndex: index,
            streamId: msg.streamId,
          },
          [pcm.buffer],
        )
        index++
      }

      if (streaming) {
        post({ type: 'done', streamId: msg.streamId, nextIndex: index })
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
