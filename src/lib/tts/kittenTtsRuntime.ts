/**
 * Browser-only KittenTTS runtime — no model-loader, npz-loader, or jszip.
 */
import { basic_english_tokenize, textToIds } from 'kitten-tts-js/src/text-cleaner.js'
import { TextPreprocessor } from 'kitten-tts-js/src/preprocess.js'
import { phonemize } from '@/lib/tts/phonemizerLazy'
import type * as OrtNamespace from 'onnxruntime-web/wasm'
import { trimPcmSilence } from '@/lib/audio/trimSilence'

const SAMPLE_RATE = 24000
const MAX_CHUNK_CHARS = 200
/**
 * PL-BERT in kitten_tts_micro_v0_8.ort has a hard maximum of 512 tokens
 * (513+ crashes `/bert/Expand` with `invalid expand shape`), and `voices.npz`
 * has 400 style rows. Capping content tokens at 360 ensures `[0, ...ids, 10, 0]`
 * never exceeds 363 tokens.
 */
const MAX_CONTENT_TOKENS = 360
const SPACE_TOKEN_ID = 16
const MIN_PRONOUNCEABLE_TOKEN_ID = 17

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

type PreparedInferenceInput = {
  input_ids: number[]
  style: Float32Array
  styleDim: number
  speed: number
}

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

function splitTokenIds(rawIds: number[], maxTokens: number): number[][] {
  if (rawIds.length <= maxTokens) return [rawIds]

  const batches: number[][] = []
  let start = 0

  while (start < rawIds.length) {
    let end = Math.min(start + maxTokens, rawIds.length)
    if (end < rawIds.length) {
      let splitAt = -1
      for (let i = end; i > start + Math.floor(maxTokens / 2); i--) {
        if (rawIds[i] === SPACE_TOKEN_ID) {
          splitAt = i
          break
        }
      }
      if (splitAt !== -1) {
        end = splitAt
      }
    }

    const slice = rawIds.slice(start, end).filter((id, idx, arr) => {
      if (idx === 0 && id === SPACE_TOKEN_ID) return false
      if (idx === arr.length - 1 && id === SPACE_TOKEN_ID) return false
      return true
    })
    if (slice.some((id) => id >= MIN_PRONOUNCEABLE_TOKEN_ID)) {
      batches.push(slice)
    }

    start = end
    while (start < rawIds.length && rawIds[start] === SPACE_TOKEN_ID) {
      start++
    }
  }

  return batches
}

export class KittenTtsRuntime {
  private readonly ort: typeof OrtNamespace
  private readonly preprocessor = new TextPreprocessor({ remove_punctuation: false })
  private inferenceChain: Promise<void> = Promise.resolve()
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
    const chunks = this.chunkText(text, clean)
    const audioChunks: Float32Array[] = []

    for (let i = 0; i < chunks.length; i++) {
      if (shouldAbort?.()) break
      if (i > 0) await yieldToEventLoop()
      const preparedBatches = await this.prepareInputs(chunks[i], voice, speed)
      for (const inputs of preparedBatches) {
        if (shouldAbort?.()) break
        await yieldToEventLoop()
        if (shouldAbort?.()) break
        const pcm = await this.runInference(inputs)
        if (pcm.length > 0) {
          audioChunks.push(pcm)
        }
      }
    }

    if (audioChunks.length === 0) {
      return { data: new Float32Array(0), sampling_rate: SAMPLE_RATE }
    }

    if (audioChunks.length === 1) {
      return {
        data: audioChunks[0],
        sampling_rate: SAMPLE_RATE,
      }
    }

    const totalLen = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combined = new Float32Array(totalLen)
    let offset = 0
    for (const chunk of audioChunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    return {
      data: combined,
      sampling_rate: SAMPLE_RATE,
    }
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

  private splitWordsToChunks(text: string, out: string[]): void {
    const words = text.split(/\s+/).filter(Boolean)
    let tempChunk = ''
    for (const word of words) {
      if (word.length > MAX_CHUNK_CHARS) {
        if (tempChunk) {
          out.push(this.ensurePunctuation(tempChunk))
          tempChunk = ''
        }
        for (let i = 0; i < word.length; i += MAX_CHUNK_CHARS) {
          out.push(this.ensurePunctuation(word.slice(i, i + MAX_CHUNK_CHARS)))
        }
        continue
      }
      if (tempChunk.length + word.length + 1 <= MAX_CHUNK_CHARS) {
        tempChunk += tempChunk ? ` ${word}` : word
      } else {
        if (tempChunk) out.push(this.ensurePunctuation(tempChunk))
        tempChunk = word
      }
    }
    if (tempChunk) out.push(this.ensurePunctuation(tempChunk))
  }

  private chunkText(text: string, clean = true): string[] {
    const sentences = text.split(/(?<=[.!?])\s+|\n+/)
    const chunks: string[] = []

    for (const rawSentence of sentences) {
      const processed = clean ? this.preprocessor.process(rawSentence) : rawSentence
      const trimmed = processed.replace(/\s+/g, ' ').trim()
      if (!trimmed) continue

      if (trimmed.length <= MAX_CHUNK_CHARS) {
        chunks.push(this.ensurePunctuation(trimmed))
        continue
      }

      const clauses = trimmed.split(/(?<=[,;:\u2014\u2013])\s+/)
      let clauseAccum = ''
      for (const clause of clauses) {
        const cleanClause = clause.trim()
        if (!cleanClause) continue
        if (cleanClause.length > MAX_CHUNK_CHARS) {
          if (clauseAccum) {
            chunks.push(this.ensurePunctuation(clauseAccum))
            clauseAccum = ''
          }
          this.splitWordsToChunks(cleanClause, chunks)
          continue
        }
        if (clauseAccum.length + cleanClause.length + 1 <= MAX_CHUNK_CHARS) {
          clauseAccum += clauseAccum ? ` ${cleanClause}` : cleanClause
        } else {
          if (clauseAccum) chunks.push(this.ensurePunctuation(clauseAccum))
          clauseAccum = cleanClause
        }
      }
      if (clauseAccum) chunks.push(this.ensurePunctuation(clauseAccum))
    }

    return chunks
  }

  private async prepareInputs(
    preprocessedChunk: string,
    voiceName: string,
    speed: number,
  ): Promise<PreparedInferenceInput[]> {
    let phonemes = await phonemize(preprocessedChunk)
    phonemes = basic_english_tokenize(phonemes).join(' ')
    if (!phonemes.trim()) return []

    const rawIds = textToIds(phonemes)
    if (!rawIds.some((id) => id >= MIN_PRONOUNCEABLE_TOKEN_ID)) {
      return []
    }

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

    let effectiveSpeed = speed
    if (this.speedPriors[voiceKey]) {
      effectiveSpeed *= this.speedPriors[voiceKey]
    }

    const batches = splitTokenIds(rawIds, MAX_CONTENT_TOKENS)
    return batches.map((batchIds) => {
      const tokenIds = [0, ...batchIds, 10, 0]
      const refId = Math.min(tokenIds.length, voiceEntry.shape[0] - 1)
      const style = voiceData.slice(refId * styleDim, (refId + 1) * styleDim)
      return {
        input_ids: tokenIds,
        style,
        styleDim,
        speed: effectiveSpeed,
      }
    })
  }

  private async runInference({
    input_ids,
    style,
    styleDim,
    speed,
  }: PreparedInferenceInput): Promise<Float32Array> {
    const prev = this.inferenceChain
    let release!: () => void
    this.inferenceChain = new Promise<void>((resolve) => {
      release = resolve
    })

    await prev
    try {
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
      return trimPcmSilence(audioData, { sampleRate: SAMPLE_RATE })
    } finally {
      release()
    }
  }
}
