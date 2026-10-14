import { audioScheduler } from '@/lib/audio/scheduler'
import type { WordPosition } from '@/lib/types'

export interface WordTiming {
  wordIndex: number
  sentenceIndex: number
  startTime: number
  endTime: number
  pageNum: number
}

type WordCallback = (wordIndex: number, pageNum: number, sentenceIndex: number) => void

export function estimateWordSpeechWeight(text: string, isLastInSentence: boolean): number {
  const cleanLen = text.replace(/[^\w]/g, '').length
  // Spoken word duration has a fixed articulation onset plus sub-linear character scaling
  let weight = 1.6 + Math.pow(Math.max(1, cleanLen), 0.75)
  if (!isLastInSentence) {
    if (/[,;:—–-]$/.test(text)) {
      weight += 2.2
    } else if (/[.!?]$/.test(text)) {
      weight += 3.0
    }
  }
  return weight
}

export class HighlightSync {
  private timings: WordTiming[] = []
  private rafId: number | null = null
  private ctx: AudioContext | null = null
  private baseOffset = 0
  private onWordChange: WordCallback | null = null
  private lastWordIndex = -1
  private isPaused = true
  private pausedAt = 0

  setContext(ctx: AudioContext): void {
    this.ctx = ctx
  }

  onWord(callback: WordCallback): void {
    this.onWordChange = callback
  }

  registerSentenceTiming(
    words: WordPosition[],
    startTime: number,
    duration: number,
  ): void {
    if (words.length === 0 || duration <= 0) return

    const weights = words.map((w, idx) =>
      estimateWordSpeechWeight(w.text, idx === words.length - 1),
    )
    const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1

    let cursor = startTime
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      const wordDuration = duration * (weights[i] / totalWeight)
      this.timings.push({
        wordIndex: word.globalIndex,
        sentenceIndex: word.sentenceIndex,
        startTime: cursor,
        endTime: cursor + wordDuration,
        pageNum: word.pageNum,
      })
      cursor += wordDuration
    }

    // If playback loop is already running (or waiting for the first chunk), sync immediately
    if (!this.isPaused && this.lastWordIndex === -1 && this.timings.length > 0) {
      const currentTime = audioScheduler.getCurrentTime()
      const timing = this.findTimingAt(currentTime) ?? this.timings[0]
      if (timing) {
        this.fireWord(timing.wordIndex, timing.pageNum, timing.sentenceIndex)
      }
    }
  }

  clear(): void {
    this.timings = []
    this.lastWordIndex = -1
    this.stopLoop()
  }

  seekToTime(time: number): void {
    this.pausedAt = time
    const timing = this.findTimingAt(time)
    if (timing) {
      this.fireWord(timing.wordIndex, timing.pageNum, timing.sentenceIndex)
    }
  }

  seekToWord(wordIndex: number): void {
    const timing = this.timings.find((t) => t.wordIndex === wordIndex)
    if (timing) {
      this.pausedAt = timing.startTime
      this.fireWord(timing.wordIndex, timing.pageNum, timing.sentenceIndex)
    }
  }

  start(): void {
    this.isPaused = false
    const currentTime = audioScheduler.getCurrentTime()
    const timing = this.findTimingAt(currentTime)
    if (timing) {
      this.fireWord(timing.wordIndex, timing.pageNum, timing.sentenceIndex)
    }
    this.startLoop()
  }

  pause(): void {
    if (!this.isPaused) {
      this.pausedAt = audioScheduler.getCurrentTime()
    } else if (this.ctx) {
      this.pausedAt = this.ctx.currentTime - this.baseOffset
    }
    this.isPaused = true
    this.stopLoop()
  }

  setBaseOffset(offset: number): void {
    this.baseOffset = offset
  }

  /** Rescale future word timings when playback speed changes mid-stream. */
  rescaleTimings(rateRatio: number, pivotTime: number): void {
    if (rateRatio === 1) return

    for (const timing of this.timings) {
      if (timing.endTime <= pivotTime) continue

      if (timing.startTime < pivotTime) {
        timing.endTime = pivotTime + (timing.endTime - pivotTime) * rateRatio
        continue
      }

      timing.startTime = pivotTime + (timing.startTime - pivotTime) * rateRatio
      timing.endTime = pivotTime + (timing.endTime - pivotTime) * rateRatio
    }
  }

  private findTimingAt(time: number): WordTiming | undefined {
    const len = this.timings.length
    if (len === 0) return undefined

    let lo = 0
    let hi = len - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const t = this.timings[mid]
      if (time < t.startTime) {
        hi = mid - 1
      } else if (time >= t.endTime) {
        lo = mid + 1
      } else {
        return t
      }
    }
    return undefined
  }

  private fireWord(wordIndex: number, pageNum: number, sentenceIndex: number): void {
    if (wordIndex !== this.lastWordIndex) {
      this.lastWordIndex = wordIndex
      this.onWordChange?.(wordIndex, pageNum, sentenceIndex)
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return

    const tick = () => {
      if (!this.isPaused) {
        const currentTime = audioScheduler.getCurrentTime()
        const timing = this.findTimingAt(currentTime)
        if (timing) {
          this.fireWord(timing.wordIndex, timing.pageNum, timing.sentenceIndex)
        }
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
}

export const highlightSync = new HighlightSync()
