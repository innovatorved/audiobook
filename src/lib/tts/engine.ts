import type { ProgressCallback, VoiceInfo } from '@/lib/types'

export interface TtsStreamChunk {
  text: string
  pcm: Float32Array
  sampleRate: number
}

export interface TtsStreamOptions {
  voice: string
  speed: number
  /** Return true to abort the stream as early as possible. Checked between chunks. */
  shouldAbort?: () => boolean
}

export interface TtsEngine {
  load(onProgress: ProgressCallback): Promise<void>
  stream(chunks: string[], opts: TtsStreamOptions): AsyncIterable<TtsStreamChunk>
  listVoices(): VoiceInfo[]
}
