import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk, TtsStreamOptions } from '@/lib/tts/engine'
import type { CompileStage } from '@/lib/tts/kittenTypes'

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

class LoadAbortedError extends Error {
  constructor() {
    super('Voice engine load aborted')
    this.name = 'LoadAbortedError'
  }
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
  private worker: Worker | null = null
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
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.voices = []
  }

  private spawnWorker(): Worker {
    const worker = new Worker(new URL('../../workers/kittenOrt.worker.ts', import.meta.url), {
      type: 'module',
    })
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
    return worker
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = this.spawnWorker()
    }
    return this.worker
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

  private loadOnce(
    onProgress: ProgressCallback,
    preload: KittenPreload,
    opts?: KittenLoadOptions,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = this.getWorker()
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
        },
        [preload.modelBuffer, preload.voicesBuffer],
      )
    })
  }

  async load(
    onProgress: ProgressCallback,
    preload?: KittenPreload,
    opts?: KittenLoadOptions,
  ): Promise<void> {
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
    return this.voices.map((id) => ({ id, label: id }))
  }

  private requestGenerate(text: string, voice: string, speed: number): Promise<TtsStreamChunk | null> {
    return new Promise((resolve, reject) => {
      const id = this.nextRequestId++
      this.pendingGenerates.set(id, { resolve, reject })
      this.getWorker().postMessage({
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
    if (this.voices.length === 0) {
      throw new Error('Kitten TTS not loaded')
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
