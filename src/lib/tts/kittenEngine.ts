import { loadNpz } from '@/lib/tts/npzLoader'
import { KittenTtsRuntime } from '@/lib/tts/kittenTtsRuntime'
import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk, TtsStreamOptions } from '@/lib/tts/engine'

const ESTIMATED_BYTES = 43 * 1024 * 1024

export type KittenPreload = {
  modelBuffer: ArrayBuffer
  voicesBuffer: ArrayBuffer
  config: Record<string, unknown>
}

const ORT_INIT_TIMEOUT_MS = 90_000

function isMainThread(): boolean {
  return typeof document !== 'undefined'
}

async function loadOrtWeb(): Promise<typeof import('onnxruntime-web/wasm')> {
  const ort = await import('onnxruntime-web/wasm')
  const origin =
    typeof self !== 'undefined' && 'location' in self ? self.location.origin : ''
  const base = origin ? `${origin}/ort/` : '/ort/'
  ort.env.wasm.wasmPaths = {
    mjs: `${base}ort-wasm-simd-threaded.mjs`,
    wasm: `${base}ort-wasm-simd-threaded.wasm`,
  }
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  // Proxy mode requires document (main thread) — ORT runs in its own dedicated worker.
  ort.env.wasm.proxy = isMainThread()
  ort.env.wasm.initTimeout = ORT_INIT_TIMEOUT_MS
  return ort
}

export class KittenEngine implements TtsEngine {
  private tts: KittenTtsRuntime | null = null

  async load(onProgress: ProgressCallback, preload?: KittenPreload): Promise<void> {
    if (!preload) {
      throw new Error('KittenEngine requires pre-downloaded model buffers')
    }

    onProgress({ loaded: ESTIMATED_BYTES * 0.4, total: ESTIMATED_BYTES, status: 'downloading' })
    const ort = await loadOrtWeb()
    onProgress({ loaded: ESTIMATED_BYTES * 0.55, total: ESTIMATED_BYTES, status: 'downloading' })

    const sessionPromise = ort.InferenceSession.create(preload.modelBuffer, {
      executionProviders: ['wasm'],
    })
    const sessionProgress = setInterval(() => {
      onProgress({ loaded: ESTIMATED_BYTES * 0.72, total: ESTIMATED_BYTES, status: 'downloading' })
    }, 2000)
    let session: Awaited<typeof sessionPromise>
    try {
      session = await sessionPromise
    } finally {
      clearInterval(sessionProgress)
    }
    onProgress({ loaded: ESTIMATED_BYTES * 0.85, total: ESTIMATED_BYTES, status: 'downloading' })

    const voices = await loadNpz(preload.voicesBuffer)
    this.tts = new KittenTtsRuntime(session, voices, preload.config, ort)

    onProgress({ loaded: ESTIMATED_BYTES, total: ESTIMATED_BYTES, status: 'ready' })
  }

  listVoices(): VoiceInfo[] {
    if (!this.tts) return []
    return this.tts.list_voices().map((id) => ({ id, label: id }))
  }

  async *stream(
    chunks: string[],
    opts: TtsStreamOptions,
  ): AsyncIterable<TtsStreamChunk> {
    if (!this.tts) throw new Error('Kitten TTS not loaded')

    for (const text of chunks) {
      if (opts.shouldAbort?.()) return
      const audio = await this.tts.generate(text, {
        voice: opts.voice,
        speed: opts.speed,
        shouldAbort: opts.shouldAbort,
      })
      if (opts.shouldAbort?.()) return
      yield {
        text,
        pcm: audio.data,
        sampleRate: audio.sampling_rate,
      }
    }
  }
}
