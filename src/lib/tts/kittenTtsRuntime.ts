/**
 * Browser-only KittenTTS runtime — no model-loader, npz-loader, or jszip.
 */
import { TextCleaner, basic_english_tokenize } from 'kitten-tts-js/src/text-cleaner.js'
import { TextPreprocessor } from 'kitten-tts-js/src/preprocess.js'
import { phonemize } from 'kitten-tts-js/src/phonemizer.js'
import type * as OrtNamespace from 'onnxruntime-web/wasm'

const SAMPLE_RATE = 24000
const AUDIO_TRIM = 5000
const MAX_CHUNK_CHARS = 400

const DEFAULT_VOICE_ALIASES: Record<string, string> = {
  Bella: 'expr-voice-2-f',
  Jasper: 'expr-voice-2-m',
  Luna: 'expr-voice-3-f',
  Bruno: 'expr-voice-3-m',
  Rosie: 'expr-voice-4-f',
  Hugo: 'expr-voice-4-m',
  Kiki: 'expr-voice-5-f',
  Leo: 'expr-voice-5-m',
}

export type KittenVoiceMap = Record<string, { data: Float32Array; shape: number[] }>

export class KittenTtsRuntime {
  private readonly ort: typeof OrtNamespace
  private readonly cleaner = new TextCleaner()
  private readonly preprocessor = new TextPreprocessor({ remove_punctuation: false })
  readonly voiceAliases: Record<string, string>
  readonly speedPriors: Record<string, number>
  readonly availableVoices: string[]

  constructor(
    private readonly session: OrtNamespace.InferenceSession,
    private readonly voices: KittenVoiceMap,
    config: Record<string, unknown>,
    ort: typeof OrtNamespace,
  ) {
    this.ort = ort
    this.voiceAliases = {
      ...DEFAULT_VOICE_ALIASES,
      ...((config.voice_aliases as Record<string, string> | undefined) ?? {}),
    }
    this.speedPriors = (config.speed_priors as Record<string, number> | undefined) ?? {}
    this.availableVoices = Object.keys(this.voices)
  }

  list_voices(): string[] {
    return Object.keys(this.voiceAliases)
  }

  async generate(
    text: string,
    opts: { voice?: string; speed?: number; clean?: boolean; shouldAbort?: () => boolean } = {},
  ): Promise<{ data: Float32Array; sampling_rate: number }> {
    const { voice = 'Bella', speed = 1.0, clean = true, shouldAbort } = opts
    const chunks = this.chunkText(text)
    const audioChunks: Float32Array[] = []

    for (const chunk of chunks) {
      if (shouldAbort?.()) break
      const inputs = await this.prepareInputs(chunk, voice, speed, clean)
      if (shouldAbort?.()) break
      audioChunks.push(await this.runInference(inputs))
    }

    const totalLen = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combined = new Float32Array(totalLen)
    let offset = 0
    for (const chunk of audioChunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    return { data: combined, sampling_rate: SAMPLE_RATE }
  }

  private ensurePunctuation(text: string): string {
    let trimmed = text.trim()
    if (!trimmed) return trimmed
    const last = trimmed[trimmed.length - 1]
    if (!['.', '!', '?', ',', ';', ':'].includes(last)) {
      trimmed += ','
    }
    return trimmed
  }

  private chunkText(text: string): string[] {
    const sentences = text.split(/[.!?]+/)
    const chunks: string[] = []

    for (const sentence of sentences) {
      const trimmed = sentence.trim()
      if (!trimmed) continue

      if (trimmed.length <= MAX_CHUNK_CHARS) {
        chunks.push(this.ensurePunctuation(trimmed))
        continue
      }

      const words = trimmed.split(/\s+/)
      let tempChunk = ''
      for (const word of words) {
        if (tempChunk.length + word.length + 1 <= MAX_CHUNK_CHARS) {
          tempChunk += tempChunk ? ` ${word}` : word
        } else {
          if (tempChunk) chunks.push(this.ensurePunctuation(tempChunk.trim()))
          tempChunk = word
        }
      }
      if (tempChunk) chunks.push(this.ensurePunctuation(tempChunk.trim()))
    }

    return chunks
  }

  private async prepareInputs(
    chunk: string,
    voiceName: string,
    speed: number,
    clean: boolean,
  ): Promise<{
    input_ids: number[]
    style: Float32Array
    styleDim: number
    speed: number
  }> {
    const processedText = clean ? this.preprocessor.process(chunk) : chunk
    let phonemes = await phonemize(processedText)
    phonemes = basic_english_tokenize(phonemes).join(' ')
    const tokenIds = this.cleaner.clean(phonemes)

    let voiceKey = voiceName
    if (this.voiceAliases[voiceName]) {
      voiceKey = this.voiceAliases[voiceName]
    }
    if (!this.voices[voiceKey]) {
      throw new Error(
        `Voice '${voiceName}' not found. Available: ${this.availableVoices.join(', ')}`,
      )
    }

    const voiceEntry = this.voices[voiceKey]
    const voiceData = voiceEntry.data
    const [, styleDim] = voiceEntry.shape

    if (this.speedPriors[voiceKey]) {
      speed *= this.speedPriors[voiceKey]
    }

    const refId = Math.min(tokenIds.length, voiceEntry.shape[0] - 1)
    const style = voiceData.slice(refId * styleDim, (refId + 1) * styleDim)

    return { input_ids: tokenIds, style, styleDim, speed }
  }

  private async runInference({
    input_ids,
    style,
    styleDim,
    speed,
  }: {
    input_ids: number[]
    style: Float32Array
    styleDim: number
    speed: number
  }): Promise<Float32Array> {
    const seqLen = input_ids.length
    const inputIdsTensor = new this.ort.Tensor(
      'int64',
      BigInt64Array.from(input_ids.map(BigInt)),
      [1, seqLen],
    )
    const styleTensor = new this.ort.Tensor('float32', new Float32Array(style), [1, styleDim])
    const speedTensor = new this.ort.Tensor('float32', new Float32Array([speed]), [1])

    const results = await this.session.run({
      input_ids: inputIdsTensor,
      style: styleTensor,
      speed: speedTensor,
    })

    const outputKey = Object.keys(results)[0]
    const audioData = results[outputKey].data as Float32Array
    return audioData.slice(0, Math.max(0, audioData.length - AUDIO_TRIM))
  }
}
