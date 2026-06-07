import type { SentenceInfo, WordPosition } from '@/lib/types'

export interface ScheduledSentence {
  sentenceIndex: number
  startTime: number
  duration: number
  words: WordPosition[]
}

type SentenceCallback = (sentence: ScheduledSentence) => void

export class AudioScheduler {
  private ctx: AudioContext | null = null
  private gainNode: GainNode | null = null
  private nextStartTime = 0
  private playbackRate = 1
  private volume = 1
  private sources: AudioBufferSourceNode[] = []
  private scheduledSentences: ScheduledSentence[] = []
  private onSentenceStart: SentenceCallback | null = null
  private baseTime = 0
  private pausedAt = 0
  private isPaused = true

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.gainNode = this.ctx.createGain()
      this.gainNode.connect(this.ctx.destination)
      this.gainNode.gain.value = this.volume
    }
    return this.ctx
  }

  setVolume(value: number): void {
    this.volume = value
    if (this.gainNode) {
      this.gainNode.gain.value = value
    }
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = rate
    for (const source of this.sources) {
      source.playbackRate.value = rate
    }
  }

  getPlaybackRate(): number {
    return this.playbackRate
  }

  getContext(): AudioContext | null {
    return this.ctx
  }

  getCurrentTime(): number {
    if (!this.ctx || this.isPaused) return this.pausedAt
    return this.ctx.currentTime - this.baseTime
  }

  onSentenceScheduled(callback: SentenceCallback): void {
    this.onSentenceStart = callback
  }

  async enqueueAudio(
    pcm: Float32Array,
    sampleRate: number,
    meta: { sentenceIndex: number; words: WordPosition[] },
  ): Promise<{ startTime: number; duration: number }> {
    if (this.isPaused) return { startTime: 0, duration: 0 }

    await this.ensureContext()
    if (!this.ctx || !this.gainNode) return { startTime: 0, duration: 0 }

    const buffer = this.ctx.createBuffer(1, pcm.length, sampleRate)
    buffer.copyToChannel(pcm, 0)

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = this.playbackRate
    source.connect(this.gainNode)

    const startTime = Math.max(this.nextStartTime, this.ctx.currentTime)
    const duration = buffer.duration / this.playbackRate

    source.start(startTime)
    this.sources.push(source)
    this.nextStartTime = startTime + duration

    const scheduled: ScheduledSentence = {
      sentenceIndex: meta.sentenceIndex,
      startTime: startTime - this.baseTime,
      duration,
      words: meta.words,
    }
    this.scheduledSentences.push(scheduled)
    this.onSentenceStart?.(scheduled)

    source.onended = () => {
      const idx = this.sources.indexOf(source)
      if (idx >= 0) this.sources.splice(idx, 1)
    }

    return { startTime: scheduled.startTime, duration }
  }

  getTimelineBase(): number {
    return this.baseTime
  }

  /** Allow enqueue while the context stays suspended until play(). */
  beginScheduling(): void {
    this.isPaused = false
  }

  async play(): Promise<void> {
    const ctx = await this.ensureContext()
    if (this.isPaused && this.pausedAt > 0) {
      this.baseTime = ctx.currentTime - this.pausedAt
      const offset = this.pausedAt
      this.nextStartTime = ctx.currentTime
      for (const s of this.scheduledSentences) {
        if (s.startTime >= offset) break
      }
    } else if (this.nextStartTime === 0) {
      this.baseTime = ctx.currentTime
      this.nextStartTime = ctx.currentTime
    }
    this.isPaused = false
    await ctx.resume()
  }

  async pause(): Promise<void> {
    if (!this.ctx) return
    this.pausedAt = this.getCurrentTime()
    this.isPaused = true
    this.stopAllSources()
    await this.ctx.suspend()
  }

  private stopAllSources(): void {
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    this.sources = []
  }

  isPlaying(): boolean {
    return !this.isPaused && this.ctx?.state === 'running'
  }

  clear(): void {
    this.stopAllSources()
    this.scheduledSentences = []
    this.nextStartTime = this.ctx?.currentTime ?? 0
    this.pausedAt = 0
    this.baseTime = this.ctx?.currentTime ?? 0
  }

  resetFromTime(time: number): void {
    this.clear()
    this.pausedAt = time
    this.isPaused = true
  }

  getScheduledSentences(): ScheduledSentence[] {
    return this.scheduledSentences
  }
}

export const audioScheduler = new AudioScheduler()
