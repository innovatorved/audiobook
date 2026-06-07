import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk } from '@/lib/tts/engine'

const MSG =
  'Piper engine is not included in this deployment (asset size limits). Use Balanced (Kitten) or Premium (Kokoro).'

export class PiperEngine implements TtsEngine {
  async load(_onProgress: ProgressCallback): Promise<void> {
    throw new Error(MSG)
  }

  listVoices(): VoiceInfo[] {
    return []
  }

  async *stream(): AsyncIterable<TtsStreamChunk> {
    throw new Error(MSG)
  }
}
