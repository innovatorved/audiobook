export function computeProgressPct(
  sentenceIndex: number,
  totalSentences?: number,
): number {
  if (totalSentences === undefined || totalSentences <= 0) return 0
  return Math.min(100, Math.round((sentenceIndex / totalSentences) * 100))
}
