import { describe, expect, it } from 'bun:test'
import { extractSentences } from '../pipeline/text'
import { KittenTtsRuntime } from './kittenTtsRuntime'

describe('extractSentences long sentence splitting', () => {
  it('splits run-on sentences exceeding 240 chars while preserving exact substrings of fullText', () => {
    const clauses = Array.from(
      { length: 12 },
      (_, i) => `clause ${i + 1} with years 1984 to 1999 and $12,345.67 in revenue`,
    )
    const fullText = clauses.join(', ') + '.'
    expect(fullText.length).toBeGreaterThan(500)

    const sentences = extractSentences(fullText)
    expect(sentences.length).toBeGreaterThan(2)
    for (const s of sentences) {
      expect(s.length).toBeLessThanOrEqual(240)
      expect(fullText.includes(s)).toBe(true)
    }
  })
})

describe('KittenTtsRuntime /bert/Expand protection', () => {
  function createMockRuntime() {
    const recordedSeqLengths: number[] = []
    let activeRuns = 0
    let maxConcurrentRuns = 0

    class MockTensor {
      readonly type: string
      readonly data: BigInt64Array | Float32Array
      readonly dims: readonly number[]
      constructor(type: string, data: BigInt64Array | Float32Array, dims: readonly number[]) {
        this.type = type
        this.data = data
        this.dims = dims
      }
    }

    const mockOrt = {
      Tensor: MockTensor,
    }

    const mockSession = {
      async run(feeds: Record<string, { dims: readonly number[]; data: BigInt64Array | Float32Array }>) {
        activeRuns++
        maxConcurrentRuns = Math.max(maxConcurrentRuns, activeRuns)
        const seqLen = feeds.input_ids.dims[1]
        recordedSeqLengths.push(seqLen)
        if (seqLen > 512) {
          activeRuns--
          throw new Error(
            "Non-zero status code returned while running Expand node. Name:'/bert/Expand' Status Message: invalid expand shape",
          )
        }
        await new Promise((r) => setTimeout(r, 2))
        activeRuns--
        const waveform = new Float32Array(2400)
        waveform.fill(0.15)
        return {
          waveform: {
            data: waveform,
          },
        }
      },
      async release() {},
    }

    const voices = {
      'expr-voice-2-m': {
        data: new Float32Array(400 * 256),
        shape: [400, 256],
      },
    }

    const runtime = new KittenTtsRuntime(mockSession as never, voices, {}, mockOrt as never)
    return { runtime, recordedSeqLengths, getMaxConcurrentRuns: () => maxConcurrentRuns }
  }

  it('never exceeds PL-BERT token limit even on dense number/year/currency tables', async () => {
    const { runtime, recordedSeqLengths } = createMockRuntime()
    // Dense financial/numeric text where 250 raw chars expand to >1,200 characters after TextPreprocessor
    const denseNumbers = Array.from(
      { length: 25 },
      (_, i) => `${1970 + i}-09-14 $98,765.43 99.8%`,
    ).join(' ')

    const out = await runtime.generate(denseNumbers, { voice: 'Jasper', speed: 1.0 })
    expect(out.data.length).toBeGreaterThan(0)
    expect(recordedSeqLengths.length).toBeGreaterThan(1)
    for (const seqLen of recordedSeqLengths) {
      // Must stay strictly within voices.npz (400) and PL-BERT /bert/Expand (512) limits
      expect(seqLen).toBeLessThanOrEqual(363)
      expect(seqLen).toBeGreaterThan(3)
    }
  })

  it('skips inference when chunk has no pronounceable tokens', async () => {
    const { runtime, recordedSeqLengths } = createMockRuntime()
    const out = await runtime.generate('... --- !!!', { voice: 'Jasper' })
    expect(out.data.length).toBe(0)
    expect(recordedSeqLengths.length).toBe(0)
  })

  it('serializes concurrent generate calls so session.run never overlaps', async () => {
    const { runtime, getMaxConcurrentRuns } = createMockRuntime()
    await Promise.all([
      runtime.generate('First concurrent sentence to synthesize.', { voice: 'Jasper' }),
      runtime.generate('Second concurrent sentence to synthesize.', { voice: 'Jasper' }),
    ])
    expect(getMaxConcurrentRuns()).toBe(1)
  })
})
