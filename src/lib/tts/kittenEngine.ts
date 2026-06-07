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

async function loadOrtWeb(): Promise<typeof import('onnxruntime-web/wasm')> {
  const ort = await import('onnxruntime-web/wasm')
  const origin =
    typeof self !== 'undefined' && 'location' in self ? self.location.origin : ''
  const base = origin ? `${origin}/ort/` : '/ort/'
  ort.env.wasm.wasmPaths = {
    mjs: `${base}ort-wasm-simd-threaded.mjs`,
    wasm: `${base}ort-wasm-simd-threaded.wasm`,
  }
  // Enable WASM threading when the page is cross-origin-isolated and
  // SharedArrayBuffer is available. Falls back to single-thread on platforms
  // (older iOS Safari, certain mobile WebViews) where SAB isn't usable.
  const threadCapable =
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof crossOriginIsolated !== 'undefined' &&
    crossOriginIsolated === true
  const hwThreads =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 2
  ort.env.wasm.numThreads = threadCapable ? Math.max(1, Math.min(hwThreads, 4)) : 1
  ort.env.wasm.simd = true
  ort.env.wasm.proxy = false
  return ort
}

export class KittenEngine implements TtsEngine {
  private tts: KittenTtsRuntime | null = null

  async load(onProgress: ProgressCallback, preload?: KittenPreload): Promise<void> {
    if (!preload) {
      throw new Error('KittenEngine requires pre-downloaded model buffers')
    }

    onProgress({ loaded: ESTIMATED_BYTES * 0.95, total: ESTIMATED_BYTES, status: 'downloading' })

    const ort = await loadOrtWeb()
    const session = await ort.InferenceSession.create(preload.modelBuffer, {
      executionProviders: ['wasm'],
    })
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
