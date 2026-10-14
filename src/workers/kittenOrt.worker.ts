/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web/wasm'
import { loadNpz } from '@/lib/tts/npzLoader'
import { KittenTtsRuntime } from '@/lib/tts/kittenTtsRuntime'
import { preloadPhonemizer } from '@/lib/tts/phonemizerLazy'
import type { InferenceSession } from 'onnxruntime-web/wasm'
import type { CompileStage } from '@/lib/tts/kittenTypes'

const ESTIMATED_BYTES = 58 * 1024 * 1024
const COMPILE_TIMEOUT_MS = 120_000
const ORT_INIT_TIMEOUT_MS = 120_000

const SESSION_OPTIONS: InferenceSession.SessionOptions = {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'disabled',
}

type LoadMessage = {
  type: 'load'
  modelBuffer: ArrayBuffer
  voicesBuffer: ArrayBuffer
  config: Record<string, unknown>
  wasmBase: string
  ortWasmBuffer?: ArrayBuffer
}

type GenerateMessage = {
  type: 'generate'
  id: number
  text: string
  voice: string
  speed: number
}

type WorkerInMessage = LoadMessage | GenerateMessage | { type: 'abort' }

type ProgressOutMessage = {
  type: 'progress'
  loaded: number
  total: number
  status: 'downloading' | 'ready'
  stage?: CompileStage
}

type LoadedOutMessage = {
  type: 'loaded'
  voices: string[]
}

type ChunkOutMessage = {
  type: 'chunk'
  id: number
  text: string
  pcm: Float32Array
  sampleRate: number
}

type DoneOutMessage = {
  type: 'done'
  id: number
}

type ErrorOutMessage = {
  type: 'error'
  id?: number
  message: string
  stage?: CompileStage | 'generate'
}

type QueuedGenerateMessage = GenerateMessage & {
  epoch: number
}

let tts: KittenTtsRuntime | null = null
let abortEpoch = 0
const generateQueue: QueuedGenerateMessage[] = []
let isProcessingQueue = false

function postProgress(
  loaded: number,
  total: number,
  status: 'downloading' | 'ready',
  stage?: CompileStage,
): void {
  const msg: ProgressOutMessage = { type: 'progress', loaded, total, status, stage }
  self.postMessage(msg)
}

function postError(message: string, id?: number, stage?: ErrorOutMessage['stage']): void {
  const msg: ErrorOutMessage = { type: 'error', message, id, stage }
  self.postMessage(msg)
}

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Voice engine compilation timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then((value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      })
  })
}

function configureOrt(wasmBase: string, ortWasmBuffer?: ArrayBuffer): void {
  ort.env.wasm.wasmPaths = {
    mjs: `${wasmBase}ort-wasm-simd-threaded.mjs`,
    wasm: `${wasmBase}ort-wasm-simd-threaded.wasm`,
  }
  if (ortWasmBuffer && ortWasmBuffer.byteLength > 0) {
    ort.env.wasm.wasmBinary = ortWasmBuffer
  }
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  ort.env.wasm.proxy = false
  ort.env.wasm.initTimeout = ORT_INIT_TIMEOUT_MS
}

async function handleLoad(msg: LoadMessage): Promise<void> {
  tts = null
  abortEpoch++
  generateQueue.length = 0

  postProgress(ESTIMATED_BYTES * 0.4, ESTIMATED_BYTES, 'downloading', 'ort-init')
  configureOrt(msg.wasmBase, msg.ortWasmBuffer)
  postProgress(ESTIMATED_BYTES * 0.55, ESTIMATED_BYTES, 'downloading', 'ort-init')

  postProgress(ESTIMATED_BYTES * 0.6, ESTIMATED_BYTES, 'downloading', 'compiling')
  const compileHeartbeat = setInterval(() => {
    postProgress(ESTIMATED_BYTES * 0.65, ESTIMATED_BYTES, 'downloading', 'compiling')
  }, 5000)
  let session
  try {
    session = await raceWithTimeout(
      ort.InferenceSession.create(msg.modelBuffer, SESSION_OPTIONS),
      COMPILE_TIMEOUT_MS,
    )
  } finally {
    clearInterval(compileHeartbeat)
  }

  postProgress(ESTIMATED_BYTES * 0.85, ESTIMATED_BYTES, 'downloading', 'voices')
  const [voices] = await Promise.all([loadNpz(msg.voicesBuffer), preloadPhonemizer()])
  tts = new KittenTtsRuntime(session, voices, msg.config, ort)

  const voiceList = tts.list_voices()
  postProgress(ESTIMATED_BYTES, ESTIMATED_BYTES, 'ready', 'ready')
  const loadedMsg: LoadedOutMessage = { type: 'loaded', voices: voiceList }
  self.postMessage(loadedMsg)
}

function processGenerateQueue(): void {
  if (isProcessingQueue) return
  isProcessingQueue = true

  void (async () => {
    while (generateQueue.length > 0) {
      const msg = generateQueue.shift()!
      const isAborted = () => msg.epoch !== abortEpoch

      if (isAborted()) {
        const doneMsg: DoneOutMessage = { type: 'done', id: msg.id }
        self.postMessage(doneMsg)
        continue
      }

      if (!tts) {
        postError('Kitten TTS not loaded', msg.id, 'generate')
        continue
      }

      try {
        const audio = await tts.generate(msg.text, {
          voice: msg.voice,
          speed: msg.speed,
          shouldAbort: isAborted,
        })

        if (isAborted()) {
          const doneMsg: DoneOutMessage = { type: 'done', id: msg.id }
          self.postMessage(doneMsg)
          continue
        }

        const chunkMsg: ChunkOutMessage = {
          type: 'chunk',
          id: msg.id,
          text: msg.text,
          pcm: audio.data,
          sampleRate: audio.sampling_rate,
        }
        self.postMessage(chunkMsg, [audio.data.buffer])
        const doneMsg: DoneOutMessage = { type: 'done', id: msg.id }
        self.postMessage(doneMsg)
      } catch (err) {
        if (isAborted()) {
          const doneMsg: DoneOutMessage = { type: 'done', id: msg.id }
          self.postMessage(doneMsg)
          continue
        }
        postError(err instanceof Error ? err.message : 'Generation failed', msg.id, 'generate')
      }
    }

    isProcessingQueue = false
  })()
}

self.onerror = (event) => {
  const message =
    event.message ||
    (event.error instanceof Error ? event.error.message : '') ||
    'Kitten worker failed'
  postError(`${message} (${event.filename ?? 'worker'}:${event.lineno ?? 0})`)
}

self.onmessageerror = () => {
  postError('Worker message deserialization failed')
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data
  if (msg.type === 'abort') {
    abortEpoch++
    while (generateQueue.length > 0) {
      const item = generateQueue.shift()!
      const doneMsg: DoneOutMessage = { type: 'done', id: item.id }
      self.postMessage(doneMsg)
    }
    return
  }

  if (msg.type === 'load') {
    void handleLoad(msg).catch((err) => {
      postError(err instanceof Error ? err.message : 'Worker load error', undefined, 'compiling')
    })
    return
  }

  if (msg.type === 'generate') {
    generateQueue.push({ ...msg, epoch: abortEpoch })
    processGenerateQueue()
    return
  }
}
