/**
 * Trims leading and trailing silence from Float32Array PCM audio.
 *
 * KittenTTS / Kokoro models synthesize trailing silence (~0.8s - 1.5s)
 * after sentence-ending punctuation. If left untrimmed, this silence
 * causes long pauses between sentences and freezes highlight tracking.
 *
 * This function trims dead air while preserving a natural cushion
 * (leadPadSamples and trailPadSamples) and applying micro-fades
 * to prevent audio clicks/pops.
 */
export interface TrimOptions {
  threshold?: number
  sampleRate?: number
  leadPadSeconds?: number
  trailPadSeconds?: number
  fadeSeconds?: number
}

export function trimPcmSilence(
  pcm: Float32Array,
  options?: TrimOptions,
): Float32Array {
  const len = pcm.length
  if (len === 0) return pcm

  const threshold = options?.threshold ?? 0.005
  const sampleRate = options?.sampleRate ?? 24000
  const leadPadSamples = Math.round((options?.leadPadSeconds ?? 0.02) * sampleRate)
  const trailPadSamples = Math.round((options?.trailPadSeconds ?? 0.06) * sampleRate)
  const fadeSamples = Math.round((options?.fadeSeconds ?? 0.005) * sampleRate)

  // Find first sample exceeding threshold
  let start = 0
  while (start < len && Math.abs(pcm[start]) < threshold) {
    start++
  }

  // Entire buffer is below threshold
  if (start >= len) {
    return new Float32Array(0)
  }

  // Find last sample exceeding threshold
  let end = len - 1
  while (end > start && Math.abs(pcm[end]) < threshold) {
    end--
  }

  // Apply padding bounds
  const sliceStart = Math.max(0, start - leadPadSamples)
  const sliceEnd = Math.min(len, end + 1 + trailPadSamples)

  const trimmed = pcm.slice(sliceStart, sliceEnd)

  // Apply smooth linear micro-fade to start and end to avoid DC pops/clicks
  const actualFadeLen = Math.min(fadeSamples, Math.floor(trimmed.length / 4))
  if (actualFadeLen > 1) {
    for (let i = 0; i < actualFadeLen; i++) {
      const factor = i / actualFadeLen
      trimmed[i] *= factor
      trimmed[trimmed.length - 1 - i] *= factor
    }
  }

  return trimmed
}
