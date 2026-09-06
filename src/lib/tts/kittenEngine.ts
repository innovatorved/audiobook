import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk, TtsStreamOptions } from '@/lib/tts/engine'
import type { KittenTtsRuntime } from '@/lib/tts/kittenTtsRuntime'
import { LoadAbortedError, loadKittenOnMainThread } from '@/lib/tts/kittenMainThread'
import { getOrtWasmBinary } from '@/lib/tts/ortPreload'
import {
  isCrossOriginIsolated,
  prefersInlineWorker,
  shouldUseMainThreadOrt,
} from '@/lib/tts/kittenPlatform'
import type { CompileStage } from '@/lib/tts/kittenTypes'
import KittenWorker from '../../workers/kittenOrt.worker.ts?worker'
import InlineKittenWorker from '../../workers/kittenOrt.worker.ts?worker&inline'

const LOAD_TIMEOUT_MS = 130_000

export type KittenPreload = {
  modelBuffer: ArrayBuffer
  voicesBuffer: ArrayBuffer
  config: Record<string, unknown>
}

export type KittenLoadOptions = {
  shouldAbort?: () => boolean
  onCompiling?: () => void
  onStage?: (stage: CompileStage) => void
}

type WorkerProgressMessage = {
  type: 'progress'
  loaded: number
  total: number
  status: 'downloading' | 'ready'
  stage?: CompileStage
}

type WorkerLoadedMessage = {
  type: 'loaded'
  voices: string[]
}

type WorkerChunkMessage = {
  type: 'chunk'
  id: number
  text: string
  pcm: Float32Array
  sampleRate: number
}

type WorkerDoneMessage = {
  type: 'done'
  id: number
}

type WorkerErrorMessage = {
  type: 'error'
  id?: number
  message: string
  stage?: string
}

type WorkerOutMessage =
  | WorkerProgressMessage
  | WorkerLoadedMessage
  | WorkerChunkMessage
  | WorkerDoneMessage
  | WorkerErrorMessage

type PendingGenerate = {
  resolve: (chunk: TtsStreamChunk | null) => void
  reject: (err: Error) => void
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

function formatWorkerError(event: ErrorEvent): string {
  const parts = [event.message || 'Kitten worker failed']
  if (event.filename) {
    parts.push(`at ${event.filename}${event.lineno ? `:${event.lineno}` : ''}`)
  }
  if (event.error instanceof Error && event.error.message && !event.message) {
    parts[0] = event.error.message
  }
  return parts.join(' ')
}

export class KittenEngine implements TtsEngine {
  private readonly mainThreadMode = shouldUseMainThreadOrt()
  private tts: KittenTtsRuntime | null = null
  private worker: Worker | null = null
  private workerReady: Promise<Worker> | null = null
  private voices: string[] = []
  private nextRequestId = 1
  private loadPromise: Promise<void> | null = null
  private pendingGenerates = new Map<number, PendingGenerate>()
  private loadWaiters: {
    resolve: () => void
    reject: (err: Error) => void
    onProgress: ProgressCallback
    shouldAbort?: () => boolean
    onCompiling?: () => void
    onStage?: (stage: CompileStage) => void
  } | null = null

  dispose(): void {
    this.pendingGenerates.forEach(({ reject }) => {
      reject(new LoadAbortedError())
    })
    this.pendingGenerates.clear()
    if (this.loadWaiters) {
      this.loadWaiters.reject(new LoadAbortedError())
      this.loadWaiters = null
    }
    this.loadPromise = null
    this.tts = null
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.workerReady = null
    this.voices = []
  }

  private attachWorkerHandlers(worker: Worker): void {
    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      this.handleWorkerMessage(event.data)
    }
    worker.onerror = (event: ErrorEvent) => {
      const message = formatWorkerError(event)
      this.failLoad(new Error(message))
      this.failAllGenerates(new Error(message))
    }
    worker.onmessageerror = () => {
      const message = 'Worker message deserialization failed'
      this.failLoad(new Error(message))
      this.failAllGenerates(new Error(message))
    }
  }

  private async ensureWorker(useInline = false): Promise<Worker> {
    if (this.worker) return this.worker
    if (!this.workerReady) {
      this.workerReady = this.createWorker(useInline)
    }
    return this.workerReady
  }

  private async createWorker(useInline = false): Promise<Worker> {
    const worker = useInline ? new InlineKittenWorker() : new KittenWorker()
    this.attachWorkerHandlers(worker)
    this.worker = worker
    return worker
  }

  private failLoad(err: Error): void {
    const waiters = this.loadWaiters
    this.loadWaiters = null
    this.loadPromise = null
    waiters?.reject(err)
  }

  private failAllGenerates(err: Error): void {
    for (const pending of this.pendingGenerates.values()) {
      pending.reject(err)
    }
    this.pendingGenerates.clear()
  }

  private handleWorkerMessage(msg: WorkerOutMessage): void {
    if (msg.type === 'progress') {
      if (this.loadWaiters) {
        if (this.loadWaiters.shouldAbort?.()) {
          this.failLoad(new LoadAbortedError())
          this.dispose()
          return
        }
        if (msg.stage === 'compiling' || msg.stage === 'ort-init') {
          this.loadWaiters.onCompiling?.()
        }
        if (msg.stage) {
          this.loadWaiters.onStage?.(msg.stage)
        }
        this.loadWaiters.onProgress({
          loaded: msg.loaded,
          total: msg.total,
          status: msg.status,
        })
      }
      return
    }

    if (msg.type === 'loaded') {
      this.voices = msg.voices
      const waiters = this.loadWaiters
      this.loadWaiters = null
      this.loadPromise = null
      waiters?.resolve()
      return
    }

    if (msg.type === 'chunk') {
      const pending = this.pendingGenerates.get(msg.id)
      if (!pending) return
      pending.resolve({
        text: msg.text,
        pcm: msg.pcm,
        sampleRate: msg.sampleRate,
      })
      return
    }

    if (msg.type === 'done') {
      const pending = this.pendingGenerates.get(msg.id)
      if (!pending) return
      this.pendingGenerates.delete(msg.id)
      pending.resolve(null)
      return
    }

    if (msg.type === 'error') {
      const err = new Error(msg.message)
      if (msg.id !== undefined) {
        const pending = this.pendingGenerates.get(msg.id)
        if (pending) {
          this.pendingGenerates.delete(msg.id)
          pending.reject(err)
        }
        return
      }
      this.failLoad(err)
      this.dispose()
    }
  }

  private async loadOnceMainThread(
    onProgress: ProgressCallback,
    preload: KittenPreload,
    opts?: KittenLoadOptions,
  ): Promise<void> {
    this.tts = await loadKittenOnMainThread(
      preload.modelBuffer,
      preload.voicesBuffer,
      preload.config,
      {
        onProgress: (loaded, total, status) => {
          onProgress({ loaded, total, status })
        },
        onCompiling: opts?.onCompiling,
        onStage: opts?.onStage,
        shouldAbort: opts?.shouldAbort,
      },
    )
    this.voices = this.tts.list_voices()
  }

  private async loadOnceWorker(
    onProgress: ProgressCallback,
    preload: KittenPreload,
    opts?: KittenLoadOptions,
    useInlineWorker = prefersInlineWorker(),
  ): Promise<void> {
    const worker = await this.ensureWorker(useInlineWorker)
    const ortWasmBuffer = await getOrtWasmBinary()

    return new Promise((resolve, reject) => {
      let settled = false

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (abortPoll) clearInterval(abortPoll)
        this.loadWaiters = null
        fn()
      }

      const timer = setTimeout(() => {
        finish(() => {
          reject(new Error(`Voice engine load timed out after ${LOAD_TIMEOUT_MS}ms`))
        })
      }, LOAD_TIMEOUT_MS)

      const abortPoll = opts?.shouldAbort
        ? setInterval(() => {
            if (opts.shouldAbort?.()) {
              finish(() => {
                reject(new LoadAbortedError())
              })
            }
          }, 200)
        : null

      this.loadWaiters = {
        resolve: () => finish(resolve),
        reject: (err: Error) => finish(() => reject(err)),
        onProgress,
        shouldAbort: opts?.shouldAbort,
        onCompiling: opts?.onCompiling,
        onStage: opts?.onStage,
      }

      worker.postMessage(
        {
          type: 'load',
          modelBuffer: preload.modelBuffer,
          voicesBuffer: preload.voicesBuffer,
          config: preload.config,
          wasmBase: wasmBaseUrl(),
          ortWasmBuffer,
        },
        [preload.modelBuffer, preload.voicesBuffer, ortWasmBuffer],
      )
    })
  }

  private async loadOnce(
    onProgress: ProgressCallback,
    preload: KittenPreload,
    opts?: KittenLoadOptions,
    useInlineWorker = false,
  ): Promise<void> {
    if (this.mainThreadMode) {
      await this.loadOnceMainThread(onProgress, preload, opts)
      return
    }
    await this.loadOnceWorker(onProgress, preload, opts, useInlineWorker)
  }

  async load(
    onProgress: ProgressCallback,
    preload?: KittenPreload,
    opts?: KittenLoadOptions,
  ): Promise<void> {
    if (!isCrossOriginIsolated()) {
      throw new Error(
        'Cross-origin isolation (SharedArrayBuffer) is not available in this browser environment. Using browser speech instead.',
      )
    }

    if (!preload) {
      throw new Error('KittenEngine requires pre-downloaded model buffers')
    }

    if (this.loadPromise) {
      await this.loadPromise
      return
    }

    let lastError: Error | null = null
    this.loadPromise = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        assertNotAborted(opts?.shouldAbort)
        if (attempt > 0) {
          this.dispose()
        }
        try {
          await this.loadOnce(
            onProgress,
            {
              modelBuffer: preload.modelBuffer.slice(0),
              voicesBuffer: preload.voicesBuffer.slice(0),
              config: preload.config,
            },
            opts,
            (attempt > 0 && !this.mainThreadMode) || prefersInlineWorker(),
          )
          return
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          if (lastError instanceof LoadAbortedError) {
            throw lastError
          }
          this.dispose()
        }
      }
      throw lastError ?? new Error('Voice engine failed to load')
    })()

    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  listVoices(): VoiceInfo[] {
    if (this.tts) {
      return this.tts.list_voices().map((id) => ({ id, label: id }))
    }
    return this.voices.map((id) => ({ id, label: id }))
  }

  private requestGenerate(text: string, voice: string, speed: number): Promise<TtsStreamChunk | null> {
    return new Promise((resolve, reject) => {
      const id = this.nextRequestId++
      this.pendingGenerates.set(id, { resolve, reject })
      if (!this.worker) {
        reject(new Error('Kitten TTS not loaded'))
        return
      }
      this.worker.postMessage({
        type: 'generate',
        id,
        text,
        voice,
        speed,
      })
    })
  }

  async *stream(
    chunks: string[],
    opts: TtsStreamOptions,
  ): AsyncIterable<TtsStreamChunk> {
    if (this.voices.length === 0 && !this.tts) {
      throw new Error('Kitten TTS not loaded')
    }

    if (this.tts) {
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
      return
    }

    for (const text of chunks) {
      if (opts.shouldAbort?.()) {
        this.worker?.postMessage({ type: 'abort' })
        return
      }

      const result = await this.requestGenerate(text, opts.voice, opts.speed)
      if (opts.shouldAbort?.()) return
      if (result) {
        yield result
      }
    }
  }
}
