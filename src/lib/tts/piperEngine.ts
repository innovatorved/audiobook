import { PiperWebEngine } from 'piper-tts-web'
import type { PiperPreload } from '@/lib/tts/piperDownload'
import { PIPER_DEFAULT_VOICE } from '@/lib/tts/piperVoices'
import { createPiperCachedProvider } from '@/lib/tts/piperCachedProvider'
import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk } from '@/lib/tts/engine'

async function piperResponseToPcm(response: {
  file?: Blob
  wavBuffer?: ArrayBuffer
}): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const wavBuffer = response.wavBuffer ?? (response.file ? await response.file.arrayBuffer() : null)
  if (!wavBuffer) {
    throw new Error('Piper returned no audio data')
  }
  const view = new DataView(wavBuffer)
  const sampleRate = view.byteLength >= 28 ? view.getUint32(24, true) : 22050
  const bitsPerSample = view.byteLength >= 36 ? view.getUint16(34, true) : 16
  const numChannels = view.byteLength >= 24 ? view.getUint16(22, true) : 1

  let offset = 12
  while (offset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    )
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 'data') {
      offset += 8
      if (bitsPerSample === 16) {
        const samples = chunkSize / 2 / numChannels
        const pcm = new Float32Array(samples)
        for (let i = 0; i < samples; i++) {
          let sum = 0
          for (let ch = 0; ch < numChannels; ch++) {
            sum += view.getInt16(offset + (i * numChannels + ch) * 2, true) / 32768
          }
          pcm[i] = sum / numChannels
        }
        return { pcm, sampleRate }
      }
      break
    }
    offset += 8 + chunkSize
  }

  throw new Error('Piper WAV decode failed')
}

export type PiperLoadOptions = {
  preload: PiperPreload
  skipWarmup?: boolean
}

export class PiperEngine implements TtsEngine {
  private engine: PiperWebEngine | null = null
  private provider: ReturnType<typeof createPiperCachedProvider> | null = null
  private voices: VoiceInfo[] = []

  async load(
    onProgress: ProgressCallback,
    options?: PiperLoadOptions,
  ): Promise<void> {
    if (!options?.preload) {
      throw new Error('PiperEngine requires pre-downloaded voice buffers')
    }

    const { preload, skipWarmup = false } = options
    this.voices = preload.voices
    onProgress({ loaded: 20, total: 100, status: 'downloading' })

    this.provider = createPiperCachedProvider(preload)
    this.engine = new PiperWebEngine({ voiceProvider: this.provider })
    onProgress({ loaded: 70, total: 100, status: 'downloading' })

    if (!skipWarmup) {
      onProgress({ loaded: 80, total: 100, status: 'downloading' })
      const response = await this.engine.generate('Ready.', preload.voiceId, 0)
      await piperResponseToPcm(response)
      onProgress({ loaded: 95, total: 100, status: 'downloading' })
    }

    onProgress({ loaded: 100, total: 100, status: 'ready' })
  }

  listVoices(): VoiceInfo[] {
    return this.voices.length > 0
      ? this.voices
      : [{ id: PIPER_DEFAULT_VOICE, label: 'lessac medium' }]
  }

  async *stream(
    chunks: string[],
    opts: { voice: string; speed: number },
  ): AsyncIterable<TtsStreamChunk> {
    if (!this.engine) throw new Error('Piper TTS not loaded')

    const voice = opts.voice || PIPER_DEFAULT_VOICE
    for (const text of chunks) {
      const response = await this.engine.generate(text, voice, 0)
      const { pcm, sampleRate } = await piperResponseToPcm(response)
      yield { text, pcm, sampleRate }
    }
  }
}
