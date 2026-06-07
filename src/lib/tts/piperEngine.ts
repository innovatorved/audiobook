import { PiperWebEngine, HuggingFaceVoiceProvider } from 'piper-tts-web'
import { decodeWavToFloat32 } from '@/lib/audio/wav'
import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk } from '@/lib/tts/engine'

const DEFAULT_VOICE = 'en_US-lessac-medium'

export class PiperEngine implements TtsEngine {
  private engine: PiperWebEngine | null = null
  private voices: VoiceInfo[] = []

  async load(onProgress: ProgressCallback): Promise<void> {
    onProgress({ loaded: 10, total: 100 })
    const provider = new HuggingFaceVoiceProvider()
    const voiceList = await provider.list()
    this.voices = voiceList.slice(0, 20).map((v: string) => ({
      id: v,
      label: v.replace('en_US-', '').replace(/-/g, ' '),
    }))
    onProgress({ loaded: 50, total: 100 })
    this.engine = new PiperWebEngine({ voiceProvider: provider })
    onProgress({ loaded: 100, total: 100 })
  }

  listVoices(): VoiceInfo[] {
    return this.voices.length > 0
      ? this.voices
      : [{ id: DEFAULT_VOICE, label: 'Lessac (US)' }]
  }

  async *stream(
    chunks: string[],
    opts: { voice: string; speed: number },
  ): AsyncIterable<TtsStreamChunk> {
    if (!this.engine) throw new Error('Piper TTS not loaded')

    const voice = opts.voice || DEFAULT_VOICE
    for (const text of chunks) {
      const response = await this.engine.generate(text, voice, 0)
      const { pcm, sampleRate } = decodeWavToFloat32(response.wavBuffer)
      yield { text, pcm, sampleRate }
    }
  }
}
