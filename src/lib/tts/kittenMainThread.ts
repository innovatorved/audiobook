import { loadNpz } from '@/lib/tts/npzLoader'
import { KittenTtsRuntime } from '@/lib/tts/kittenTtsRuntime'
import { getOrtWasmBinary } from '@/lib/tts/ortPreload'
import type { CompileStage } from '@/lib/tts/kittenTypes'
import type { InferenceSession } from 'onnxruntime-web/wasm'

const ESTIMATED_BYTES = 58 * 1024 * 1024
const COMPILE_TIMEOUT_MS = 120_000
const ORT_INIT_TIMEOUT_MS = 120_000

const SESSION_OPTIONS: InferenceSession.SessionOptions = {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'disabled',
}

class LoadAbortedError extends Error {
  constructor() {
    super('Voice engine load aborted')
    this.name = 'LoadAbortedError'
  }
}

function wasmBaseUrl(): string {
  const origin =
    typeof self !== 'undefined' && 'location' in self ? self.location.origin : ''
  return origin ? `${origin}/ort/` : '/ort/'
}

function assertNotAborted(shouldAbort?: () => boolean): void {
  if (shouldAbort?.()) {
    throw new LoadAbortedError()
  }
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

async function configureMainThreadOrt(
  ort: typeof import('onnxruntime-web/wasm'),
): Promise<void> {
  const base = wasmBaseUrl()
  ort.env.wasm.wasmPaths = {
    mjs: `${base}ort-wasm-simd-threaded.mjs`,
    wasm: `${base}ort-wasm-simd-threaded.wasm`,
  }
  ort.env.wasm.wasmBinary = await getOrtWasmBinary()
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  ort.env.wasm.proxy = true
  ort.env.wasm.initTimeout = ORT_INIT_TIMEOUT_MS
}

export type MainThreadLoadCallbacks = {
  onProgress: (loaded: number, total: number, status: 'downloading' | 'ready') => void
  onCompiling?: () => void
  onStage?: (stage: CompileStage) => void
  shouldAbort?: () => boolean
}

export async function loadKittenOnMainThread(
  modelBuffer: ArrayBuffer,
  voicesBuffer: ArrayBuffer,
  config: Record<string, unknown>,
  callbacks: MainThreadLoadCallbacks,
): Promise<KittenTtsRuntime> {
  const { onProgress, onCompiling, onStage, shouldAbort } = callbacks

  assertNotAborted(shouldAbort)
  onProgress(ESTIMATED_BYTES * 0.4, ESTIMATED_BYTES, 'downloading')
  onStage?.('ort-init')

  const ort = await import('onnxruntime-web/wasm')
  assertNotAborted(shouldAbort)
  await configureMainThreadOrt(ort)

  onProgress(ESTIMATED_BYTES * 0.55, ESTIMATED_BYTES, 'downloading')
  onCompiling?.()
  onStage?.('compiling')
  onProgress(ESTIMATED_BYTES * 0.6, ESTIMATED_BYTES, 'downloading')

  assertNotAborted(shouldAbort)
  const session = await raceWithTimeout(
    ort.InferenceSession.create(modelBuffer, SESSION_OPTIONS),
    COMPILE_TIMEOUT_MS,
    shouldAbort,
  )

  onStage?.('voices')
  onProgress(ESTIMATED_BYTES * 0.85, ESTIMATED_BYTES, 'downloading')

  const voices = await loadNpz(voicesBuffer)
  assertNotAborted(shouldAbort)
  const runtime = new KittenTtsRuntime(session, voices, config, ort)

  onStage?.('ready')
  onProgress(ESTIMATED_BYTES, ESTIMATED_BYTES, 'ready')
  return runtime
}

export { LoadAbortedError }
