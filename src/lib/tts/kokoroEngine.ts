import { KokoroTTS } from 'kokoro-js'
import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk } from '@/lib/tts/engine'
import { detectBestDevice } from '@/lib/tts/device'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

export class KokoroEngine implements TtsEngine {
  private tts: KokoroTTS | null = null

  async load(onProgress: ProgressCallback): Promise<void> {
    const device = await detectBestDevice()
    const dtype = device === 'webgpu' ? 'fp32' : 'q8'
    onProgress({ loaded: 0, total: 82 * 1024 * 1024, status: 'downloading' })
    this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype,
      device,
      progress_callback: (info) => {
        if (info.status === 'progress' && info.total) {
          onProgress({
            loaded: info.loaded ?? 0,
            total: info.total,
            status: 'downloading',
          })
        }
      },
    })
    onProgress({ loaded: 82 * 1024 * 1024, total: 82 * 1024 * 1024, status: 'ready' })
  }

  listVoices(): VoiceInfo[] {
    if (!this.tts) return []
    return Object.keys(this.tts.voices).map((id) => ({
      id,
      label: this.tts!.voices[id as keyof typeof this.tts.voices]?.name ?? id,
    }))
  }

  async *stream(
    chunks: string[],
    opts: { voice: string; speed: number },
  ): AsyncIterable<TtsStreamChunk> {
    if (!this.tts) throw new Error('Kokoro TTS not loaded')

    for (const text of chunks) {
      const audio = await this.tts.generate(text, {
        voice: opts.voice as keyof typeof this.tts.voices,
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
