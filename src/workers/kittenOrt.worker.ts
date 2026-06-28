/// <reference lib="webworker" />

import { loadNpz } from '@/lib/tts/npzLoader'
import { KittenTtsRuntime } from '@/lib/tts/kittenTtsRuntime'
import type { InferenceSession } from 'onnxruntime-web/wasm'

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
}

let tts: KittenTtsRuntime | null = null
let activeGenerateId: number | null = null
let abortRequested = false

function postProgress(loaded: number, total: number, status: 'downloading' | 'ready'): void {
  const msg: ProgressOutMessage = { type: 'progress', loaded, total, status }
  self.postMessage(msg)
}

function postError(message: string, id?: number): void {
  const msg: ErrorOutMessage = { type: 'error', message, id }
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

async function loadOrt(wasmBase: string): Promise<typeof import('onnxruntime-web/wasm')> {
  const ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.wasmPaths = {
    mjs: `${wasmBase}ort-wasm-simd-threaded.mjs`,
    wasm: `${wasmBase}ort-wasm-simd-threaded.wasm`,
  }
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  ort.env.wasm.proxy = false
  ort.env.wasm.initTimeout = ORT_INIT_TIMEOUT_MS
  return ort
}

async function handleLoad(msg: LoadMessage): Promise<void> {
  tts = null
  abortRequested = false
  activeGenerateId = null

  postProgress(ESTIMATED_BYTES * 0.4, ESTIMATED_BYTES, 'downloading')

  const ort = await loadOrt(msg.wasmBase)
  postProgress(ESTIMATED_BYTES * 0.55, ESTIMATED_BYTES, 'downloading')
  postProgress(ESTIMATED_BYTES * 0.6, ESTIMATED_BYTES, 'downloading')

  const session = await raceWithTimeout(
    ort.InferenceSession.create(msg.modelBuffer, SESSION_OPTIONS),
    COMPILE_TIMEOUT_MS,
  )

  postProgress(ESTIMATED_BYTES * 0.85, ESTIMATED_BYTES, 'downloading')

  const voices = await loadNpz(msg.voicesBuffer)
  tts = new KittenTtsRuntime(session, voices, msg.config, ort)

  const voiceList = tts.list_voices()
  postProgress(ESTIMATED_BYTES, ESTIMATED_BYTES, 'ready')
  const loadedMsg: LoadedOutMessage = { type: 'loaded', voices: voiceList }
  self.postMessage(loadedMsg)
}

async function handleGenerate(msg: GenerateMessage): Promise<void> {
  if (!tts) {
    postError('Kitten TTS not loaded', msg.id)
    return
  }

  activeGenerateId = msg.id
  abortRequested = false

  try {
    const audio = await tts.generate(msg.text, {
      voice: msg.voice,
      speed: msg.speed,
      shouldAbort: () => abortRequested || activeGenerateId !== msg.id,
    })

    if (abortRequested || activeGenerateId !== msg.id) {
      const doneMsg: DoneOutMessage = { type: 'done', id: msg.id }
      self.postMessage(doneMsg)
      return
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
    if (abortRequested || activeGenerateId !== msg.id) {
      const doneMsg: DoneOutMessage = { type: 'done', id: msg.id }
      self.postMessage(doneMsg)
      return
    }
    postError(err instanceof Error ? err.message : 'Generation failed', msg.id)
  }
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data
  if (msg.type === 'abort') {
    abortRequested = true
    activeGenerateId = null
    return
  }

  void (async () => {
    try {
      if (msg.type === 'load') {
        await handleLoad(msg)
      } else if (msg.type === 'generate') {
        await handleGenerate(msg)
      }
    } catch (err) {
      postError(err instanceof Error ? err.message : 'Worker error', msg.type === 'generate' ? msg.id : undefined)
    }
  })()
}
