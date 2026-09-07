import { describe, expect, it } from 'bun:test'
import { trimPcmSilence } from './trimSilence'

describe('trimPcmSilence', () => {
  const SAMPLE_RATE = 24000

  it('returns empty array when input is empty', () => {
    const input = new Float32Array(0)
    const result = trimPcmSilence(input)
    expect(result.length).toBe(0)
  })

  it('returns empty array when entire buffer is silent', () => {
    const input = new Float32Array(SAMPLE_RATE).fill(0.0001)
    const result = trimPcmSilence(input)
    expect(result.length).toBe(0)
  })

  it('trims leading and trailing silence while preserving speech and padding', () => {
    // 1 second buffer: 0.2s silence, 0.4s tone, 0.4s silence
    const totalSamples = SAMPLE_RATE
    const input = new Float32Array(totalSamples)

    const speechStart = Math.round(0.2 * SAMPLE_RATE) // 4800
    const speechEnd = Math.round(0.6 * SAMPLE_RATE)   // 14400

    for (let i = speechStart; i < speechEnd; i++) {
      input[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
    }

    const trimmed = trimPcmSilence(input, {
      sampleRate: SAMPLE_RATE,
      leadPadSeconds: 0.02,  // 480 samples
      trailPadSeconds: 0.06, // 1440 samples
    })

    // Expected length roughly (0.4 + 0.02 + 0.06) * 24000 = 0.48 * 24000 = 11520 samples
    const expectedLength = (speechEnd - speechStart) + (0.02 * SAMPLE_RATE) + (0.06 * SAMPLE_RATE)
    expect(trimmed.length).toBeGreaterThan(0)
    expect(trimmed.length).toBeLessThan(totalSamples)
    expect(Math.abs(trimmed.length - expectedLength)).toBeLessThan(10)

    // Verify speech amplitude is intact inside the trimmed buffer
    const maxVal = trimmed.reduce((max, val) => Math.max(max, Math.abs(val)), 0)
    expect(maxVal).toBeGreaterThan(0.4)
  })

  it('does not exceed original buffer boundaries when padding is large', () => {
    const input = new Float32Array(100).fill(0.8)
    const trimmed = trimPcmSilence(input, {
      sampleRate: SAMPLE_RATE,
      leadPadSeconds: 1.0,
      trailPadSeconds: 1.0,
    })
    expect(trimmed.length).toBe(100)
  })

  it('smoothly fades boundaries to prevent clicks', () => {
    const input = new Float32Array(2000).fill(0.8)
    const trimmed = trimPcmSilence(input, {
      sampleRate: SAMPLE_RATE,
      fadeSeconds: 0.005,
    })
    expect(trimmed[0]).toBe(0)
    expect(trimmed[trimmed.length - 1]).toBe(0)
  })
})
