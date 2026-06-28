import { loadNpz } from '@/lib/tts/npzLoader'
import { KittenTtsRuntime } from '@/lib/tts/kittenTtsRuntime'
import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk, TtsStreamOptions } from '@/lib/tts/engine'
import type { InferenceSession } from 'onnxruntime-web/wasm'

const ESTIMATED_BYTES = 58 * 1024 * 1024
const ORT_INIT_TIMEOUT_MS = 90_000
const COMPILE_TIMEOUT_MS = 90_000

const SESSION_OPTIONS: InferenceSession.SessionOptions = {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'disabled',
}

export type KittenPreload = {
  modelBuffer: ArrayBuffer
  voicesBuffer: ArrayBuffer
  config: Record<string, unknown>
}

export type KittenLoadOptions = {
  shouldAbort?: () => boolean
  onCompiling?: () => void
}

class LoadAbortedError extends Error {
  constructor() {
    super('Voice engine load aborted')
    this.name = 'LoadAbortedError'
  }
}

function assertNotAborted(shouldAbort?: () => boolean): void {
  if (shouldAbort?.()) {
    throw new LoadAbortedError()
  }
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
  ort.env.wasm.proxy = false
  ort.env.wasm.initTimeout = ORT_INIT_TIMEOUT_MS
  return ort
}

function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  shouldAbort?: () => boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Voice engine compilation timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const abortPoll = shouldAbort
      ? setInterval(() => {
          if (shouldAbort()) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            clearInterval(abortPoll)
            reject(new LoadAbortedError())
          }
        }, 200)
      : null

    promise
      .then((value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (abortPoll) clearInterval(abortPoll)
        resolve(value)
      })
      .catch((err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (abortPoll) clearInterval(abortPoll)
        reject(err)
      })
  })
}

export class KittenEngine implements TtsEngine {
  private tts: KittenTtsRuntime | null = null

  async load(
    onProgress: ProgressCallback,
    preload?: KittenPreload,
    opts?: KittenLoadOptions,
  ): Promise<void> {
    if (!preload) {
      throw new Error('KittenEngine requires pre-downloaded model buffers')
    }

    const shouldAbort = opts?.shouldAbort

    assertNotAborted(shouldAbort)
    onProgress({ loaded: ESTIMATED_BYTES * 0.4, total: ESTIMATED_BYTES, status: 'downloading' })

    const ort = await loadOrtWeb()
    assertNotAborted(shouldAbort)
    onProgress({ loaded: ESTIMATED_BYTES * 0.55, total: ESTIMATED_BYTES, status: 'downloading' })

    opts?.onCompiling?.()
    onProgress({ loaded: ESTIMATED_BYTES * 0.6, total: ESTIMATED_BYTES, status: 'downloading' })

    const session = await raceWithTimeout(
      ort.InferenceSession.create(preload.modelBuffer.slice(0), SESSION_OPTIONS),
      COMPILE_TIMEOUT_MS,
      shouldAbort,
    )

    assertNotAborted(shouldAbort)
    onProgress({ loaded: ESTIMATED_BYTES * 0.85, total: ESTIMATED_BYTES, status: 'downloading' })

    const voices = await loadNpz(preload.voicesBuffer)
    assertNotAborted(shouldAbort)
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
