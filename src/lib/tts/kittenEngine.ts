import { loadNpz } from '@/lib/tts/npzLoader'
import { KittenTtsRuntime } from '@/lib/tts/kittenTtsRuntime'
import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk } from '@/lib/tts/engine'

const ESTIMATED_BYTES = 43 * 1024 * 1024

export type KittenPreload = {
  modelBuffer: ArrayBuffer
  voicesBuffer: ArrayBuffer
  config: Record<string, unknown>
}

async function loadOrtWeb(): Promise<typeof import('onnxruntime-web/wasm')> {
  const importPath = 'onnxruntime-web/wasm'
  // #region agent log
  fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'ort-fix',location:'kittenEngine.ts:loadOrtWeb',message:'importing ort',data:{importPath},timestamp:Date.now(),hypothesisId:'ort-import'})}).catch(()=>{});
  // #endregion
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
  // #region agent log
  fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'ort-fix',location:'kittenEngine.ts:loadOrtWeb',message:'ort wasmPaths configured',data:{base,wasmPaths:ort.env.wasm.wasmPaths,numThreads:ort.env.wasm.numThreads,simd:ort.env.wasm.simd},timestamp:Date.now(),hypothesisId:'ort-config'})}).catch(()=>{});
  // #endregion
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
    let session
    try {
      session = await ort.InferenceSession.create(preload.modelBuffer, {
        executionProviders: ['wasm'],
      })
      // #region agent log
      fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'ort-fix',location:'kittenEngine.ts:load',message:'ORT session created',data:{inputNames:session.inputNames,outputNames:session.outputNames},timestamp:Date.now(),hypothesisId:'ort-init'})}).catch(()=>{});
      // #endregion
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'ort-fix',location:'kittenEngine.ts:load',message:'ORT session failed',data:{error:err instanceof Error?{name:err.name,message:err.message,stack:err.stack?.slice(0,500)}:String(err)},timestamp:Date.now(),hypothesisId:'ort-init'})}).catch(()=>{});
      // #endregion
      throw err
    }
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
    opts: { voice: string; speed: number },
  ): AsyncIterable<TtsStreamChunk> {
    if (!this.tts) throw new Error('Kitten TTS not loaded')

    for (const text of chunks) {
      const audio = await this.tts.generate(text, {
        voice: opts.voice,
        speed: opts.speed,
      })
      yield {
        text,
        pcm: audio.data,
        sampleRate: audio.sampling_rate,
      }
    }
  }
}
