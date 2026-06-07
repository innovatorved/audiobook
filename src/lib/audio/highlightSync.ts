import { audioScheduler } from '@/lib/audio/scheduler'
import type { WordPosition } from '@/lib/types'

export interface WordTiming {
  wordIndex: number
  startTime: number
  endTime: number
  pageNum: number
}

type WordCallback = (wordIndex: number, pageNum: number) => void

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
    const totalChars = words.reduce((sum, w) => sum + w.text.length, 0) || 1

    let cursor = startTime
    for (const word of words) {
      const weight = word.text.length / totalChars
      const wordDuration = duration * weight
      this.timings.push({
        wordIndex: word.globalIndex,
        startTime: cursor,
        endTime: cursor + wordDuration,
        pageNum: word.pageNum,
      })
      cursor += wordDuration
    }
    // #region agent log
    fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'highlight-sync-v2',location:'highlightSync.ts:registerSentenceTiming',message:'timings registered',data:{startTime,duration,wordCount:words.length,firstWord:words[0]?.globalIndex,lastWord:words[words.length-1]?.globalIndex,endTime:cursor},timestamp:Date.now(),hypothesisId:'timing-register'})}).catch(()=>{});
    // #endregion
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
      this.fireWord(timing.wordIndex, timing.pageNum)
    }
  }

  seekToWord(wordIndex: number): void {
    const timing = this.timings.find((t) => t.wordIndex === wordIndex)
    if (timing) {
      this.pausedAt = timing.startTime
      this.fireWord(timing.wordIndex, timing.pageNum)
    }
  }

  start(): void {
    this.isPaused = false
    this.startLoop()
  }

  pause(): void {
    if (this.ctx && !this.isPaused) {
      this.pausedAt = this.ctx.currentTime - this.baseOffset
    }
    this.isPaused = true
    this.stopLoop()
  }

  setBaseOffset(offset: number): void {
    this.baseOffset = offset
  }

  private findTimingAt(time: number): WordTiming | undefined {
    for (let i = this.timings.length - 1; i >= 0; i--) {
      const t = this.timings[i]
      if (time >= t.startTime && time < t.endTime) return t
    }
    return undefined
  }

  private fireWord(wordIndex: number, pageNum: number): void {
    if (wordIndex !== this.lastWordIndex) {
      this.lastWordIndex = wordIndex
      // #region agent log
      fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'highlight-sync-v2',location:'highlightSync.ts:fireWord',message:'active word changed',data:{wordIndex,pageNum,playbackTime:audioScheduler.getCurrentTime()},timestamp:Date.now(),hypothesisId:'sync-loop'})}).catch(()=>{});
      // #endregion
      this.onWordChange?.(wordIndex, pageNum)
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return

    const tick = () => {
      if (!this.isPaused) {
        const currentTime = audioScheduler.getCurrentTime()
        const timing = this.findTimingAt(currentTime)
        if (timing) {
          this.fireWord(timing.wordIndex, timing.pageNum)
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
