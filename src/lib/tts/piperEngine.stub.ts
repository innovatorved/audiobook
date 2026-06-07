import type { ProgressCallback, VoiceInfo } from '@/lib/types'
import type { TtsEngine, TtsStreamChunk } from '@/lib/tts/engine'

const MSG =
  'Fast CPU (Piper) is not available in this deployment. Switch to Balanced (Kitten).'

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
