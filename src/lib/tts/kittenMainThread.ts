import { loadNpz } from '@/lib/tts/npzLoader'
import { KittenTtsRuntime } from '@/lib/tts/kittenTtsRuntime'
import { getOrtWasmBinary } from '@/lib/tts/ortPreload'
import { preloadPhonemizer } from '@/lib/tts/phonemizerLazy'
import type { CompileStage } from '@/lib/tts/kittenTypes'
import type { InferenceSession } from 'onnxruntime-web/webgpu'

const ESTIMATED_BYTES = 92 * 1024 * 1024
const COMPILE_TIMEOUT_MS = 120_000
const ORT_INIT_TIMEOUT_MS = 120_000

async function hasUsableWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    if (!gpu || typeof gpu.requestAdapter !== 'function') return false
    const adapter = await gpu.requestAdapter()
    return Boolean(adapter)
  } catch {
    return false
  }
}

function getSessionOptions(
  config: Record<string, unknown>,
  useWebGpu: boolean,
): InferenceSession.SessionOptions {
  return {
    executionProviders: useWebGpu ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: config.model_type === 'kokoro' ? 'all' : 'disabled',
  }
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
  ort: typeof import('onnxruntime-web/webgpu'),
  useWebGpu: boolean,
): Promise<void> {
  const base = wasmBaseUrl()
  ort.env.wasm.wasmPaths = {
    mjs: `${base}ort-wasm-simd-threaded.jsep.mjs`,
    wasm: `${base}ort-wasm-simd-threaded.jsep.wasm`,
  }
  ort.env.wasm.wasmBinary = await getOrtWasmBinary()
  const canThread =
    typeof self !== 'undefined' &&
    Boolean(self.crossOriginIsolated) &&
    typeof SharedArrayBuffer !== 'undefined'
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2
  ort.env.wasm.numThreads = canThread ? Math.min(4, Math.max(2, Math.floor(cores / 2))) : 1
  ort.env.wasm.simd = true
  // WebGPU must run without WASM proxy worker; WASM CPU uses proxy worker
  ort.env.wasm.proxy = !useWebGpu
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

  const ort = await import('onnxruntime-web/webgpu')
  assertNotAborted(shouldAbort)
  const useWebGpu = await hasUsableWebGpu()
  await configureMainThreadOrt(ort, useWebGpu)

  onProgress(ESTIMATED_BYTES * 0.55, ESTIMATED_BYTES, 'downloading')
  onCompiling?.()
  onStage?.('compiling')
  onProgress(ESTIMATED_BYTES * 0.6, ESTIMATED_BYTES, 'downloading')

  assertNotAborted(shouldAbort)
  const compileHeartbeat = setInterval(() => {
    onProgress(ESTIMATED_BYTES * 0.65, ESTIMATED_BYTES, 'downloading')
    onStage?.('compiling')
  }, 5000)
  let session
  try {
    try {
      session = await raceWithTimeout(
        ort.InferenceSession.create(modelBuffer, getSessionOptions(config, useWebGpu)),
        COMPILE_TIMEOUT_MS,
        shouldAbort,
      )
    } catch (webGpuErr) {
      if (!useWebGpu) throw webGpuErr
      console.warn('[TTS] WebGPU session failed, falling back to WASM:', webGpuErr)
      session = await raceWithTimeout(
        ort.InferenceSession.create(modelBuffer, getSessionOptions(config, false)),
        COMPILE_TIMEOUT_MS,
        shouldAbort,
      )
    }
  } finally {
    clearInterval(compileHeartbeat)
  }

  onStage?.('voices')
  onProgress(ESTIMATED_BYTES * 0.85, ESTIMATED_BYTES, 'downloading')

  const [voices] = await Promise.all([loadNpz(voicesBuffer), preloadPhonemizer()])
  assertNotAborted(shouldAbort)
  const runtime = new KittenTtsRuntime(session, voices, config, ort)

  onStage?.('ready')
  onProgress(ESTIMATED_BYTES, ESTIMATED_BYTES, 'ready')
  return runtime
}

export { LoadAbortedError }
