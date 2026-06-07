import type { ProgressCallback, VoiceInfo } from '@/lib/types'

export interface TtsStreamChunk {
  text: string
  pcm: Float32Array
  sampleRate: number
}

export interface TtsEngine {
  load(onProgress: ProgressCallback): Promise<void>
  stream(
    chunks: string[],
    opts: { voice: string; speed: number },
  ): AsyncIterable<TtsStreamChunk>
  listVoices(): VoiceInfo[]
}
