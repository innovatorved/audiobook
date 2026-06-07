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

  // eslint-disable-next-line require-yield -- stub throws before yielding; signature must remain a generator
  async *stream(): AsyncIterable<TtsStreamChunk> {
    throw new Error(MSG)
  }
}
