import { estimateWordSpeechWeight } from '@/lib/audio/highlightSync'
import { sliceWordsByGlobalRange } from '@/lib/audio/streamText'
import type { SentenceInfo, VoiceInfo, WordPosition } from '@/lib/types'
import { usePlayerStore } from '@/stores/playerStore'

const DEFAULT_BROWSER_VOICE = '__browser_default__'

type BrowserSpeechOptions = {
  sentenceTexts: string[]
  sentences: SentenceInfo[]
  words: WordPosition[]
  startIndex: number
  startWordIndex?: number
  voice: string
  speed: number
  volume: number
  onSentence: (sentenceIndex: number, wordIndex: number, pageNum: number) => void
  onWord: (wordIndex: number, pageNum: number) => void
  onDone?: () => void
}

let voicesReadyPromise: Promise<SpeechSynthesisVoice[]> | null = null
let browserVoicesCached: VoiceInfo[] = []

function isAndroidBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

export function browserTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

export function areBrowserVoicesWarmed(): boolean {
  return browserVoicesCached.length > 0
}

export function getWarmedBrowserVoices(): VoiceInfo[] {
  return browserVoicesCached
}

function mapVoice(voice: SpeechSynthesisVoice): VoiceInfo {
  return {
    id: voice.voiceURI || voice.name,
    label: `${voice.name}${voice.lang ? ` (${voice.lang})` : ''}`,
    recommended: voice.default,
  }
}

function englishVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'))
}

export function listBrowserVoices(): VoiceInfo[] {
  if (!browserTtsSupported()) return []
  if (browserVoicesCached.length > 0) return browserVoicesCached
  const voices = englishVoices(window.speechSynthesis.getVoices())
  return voices.map(mapVoice)
}

export async function loadBrowserVoices(): Promise<VoiceInfo[]> {
  if (!browserTtsSupported()) return []
  const current = window.speechSynthesis.getVoices()
  if (current.length > 0) return englishVoices(current).map(mapVoice)

  voicesReadyPromise ??= new Promise((resolve) => {
    const finish = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', finish)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', finish)
    window.setTimeout(finish, 750)
  })

  return englishVoices(await voicesReadyPromise).map(mapVoice)
}

/** Load browser voice list without changing engine or ready state. */
export async function warmBrowserVoices(): Promise<VoiceInfo[]> {
  if (!browserTtsSupported()) return []
  const voices = await loadBrowserVoices()
  browserVoicesCached = voices
  return voices
}

/** Switch playback to browser TTS and mark the engine ready. */
export async function activateBrowserEngine(): Promise<void> {
  if (!browserTtsSupported()) {
    usePlayerStore.getState().setModelError('Browser text-to-speech is not available in this browser.')
    return
  }

  const voices = await warmBrowserVoices()
  usePlayerStore.setState({
    engine: 'browser',
    voices,
    voice: resolveBrowserVoiceId(usePlayerStore.getState().voice, voices),
    isModelLoading: false,
    isModelReady: true,
    engineReady: true,
    modelProgress: 100,
    modelStatus: 'ready',
    modelLoadPhase: 'ready',
    modelError: null,
    modelLoadedBytes: 0,
    modelTotalBytes: 0,
  })
}

/** @deprecated Use activateBrowserEngine() */
export async function prepareBrowserTts(): Promise<void> {
  await activateBrowserEngine()
}

export function resolveBrowserVoiceId(current: string | undefined, voices: VoiceInfo[]): string {
  if (current && current !== DEFAULT_BROWSER_VOICE && voices.some((v) => v.id === current)) {
    return current
  }
  return voices.find((v) => v.recommended)?.id ?? voices[0]?.id ?? DEFAULT_BROWSER_VOICE
}

function findSpeechVoice(id: string): SpeechSynthesisVoice | undefined {
  if (!browserTtsSupported() || id === DEFAULT_BROWSER_VOICE) return undefined
  return window.speechSynthesis.getVoices().find((v) => v.voiceURI === id || v.name === id)
}

function sentenceWordsFor(
  sentence: SentenceInfo | undefined,
  words: WordPosition[],
  startWordIndex?: number,
): WordPosition[] {
  if (!sentence) return []
  const start =
    startWordIndex !== undefined
      ? Math.max(sentence.startWordIndex, startWordIndex)
      : sentence.startWordIndex
  return sliceWordsByGlobalRange(words, start, sentence.endWordIndex)
}

function wordForBoundary(sentenceWords: WordPosition[], charIndex: number): WordPosition | undefined {
  if (sentenceWords.length === 0) return undefined
  let cursor = 0
  for (const word of sentenceWords) {
    const next = cursor + word.text.length
    if (charIndex <= next) return word
    cursor = next + 1
  }
  return sentenceWords[sentenceWords.length - 1]
}

function buildSyntheticWordSchedule(
  sentenceWords: WordPosition[],
  rate: number,
): number[] {
  if (sentenceWords.length === 0) return []
  const safeRate = Math.max(0.25, rate)
  // Average spoken cadence at 1.0x is ~105ms per speech-weight unit
  const msPerWeightUnit = 105 / safeRate
  const offsetsMs: number[] = []
  let cumulativeMs = 0
  for (let i = 0; i < sentenceWords.length; i++) {
    offsetsMs.push(cumulativeMs)
    const weight = estimateWordSpeechWeight(
      sentenceWords[i].text,
      i === sentenceWords.length - 1,
    )
    cumulativeMs += weight * msPerWeightUnit
  }
  return offsetsMs
}

class BrowserSpeechController {
  private options: BrowserSpeechOptions | null = null
  private currentIndex = 0
  private cancelled = false
  private paused = false
  private activeUtterance: SpeechSynthesisUtterance | null = null
  private syntheticTimer: ReturnType<typeof setInterval> | null = null
  private lastWordIndex: number | undefined = undefined

  private clearSyntheticTimer(): void {
    if (this.syntheticTimer !== null) {
      clearInterval(this.syntheticTimer)
      this.syntheticTimer = null
    }
  }

  play(options: BrowserSpeechOptions): void {
    this.cancel()
    if (!browserTtsSupported()) {
      usePlayerStore.getState().setModelError('Browser text-to-speech is not available in this browser.')
      return
    }
    this.options = options
    this.currentIndex = Math.max(0, Math.min(options.startIndex, options.sentenceTexts.length - 1))
    this.lastWordIndex = options.startWordIndex
    this.cancelled = false
    this.paused = false
    this.speakCurrent(options.startWordIndex)
  }

  pause(): void {
    if (!browserTtsSupported()) return
    this.paused = true
    this.clearSyntheticTimer()
    if (isAndroidBrowser()) {
      // Android Chrome speechSynthesis.pause() is a no-op / wedges the queue; cancel and resume from lastWordIndex
      this.activeUtterance = null
      window.speechSynthesis.cancel()
    } else {
      window.speechSynthesis.pause()
    }
  }

  resume(): void {
    if (!browserTtsSupported()) return
    const wasPaused = this.paused
    this.paused = false
    if (isAndroidBrowser() || (wasPaused && !window.speechSynthesis.speaking)) {
      this.speakCurrent(this.lastWordIndex)
    } else {
      window.speechSynthesis.resume()
    }
  }

  cancel(): void {
    this.cancelled = true
    this.paused = false
    this.activeUtterance = null
    this.clearSyntheticTimer()
    if (browserTtsSupported()) window.speechSynthesis.cancel()
  }

  private speakCurrent(resumeFromWordIndex?: number): void {
    this.clearSyntheticTimer()
    const options = this.options
    if (!options || this.cancelled) return
    if (this.currentIndex >= options.sentenceTexts.length) {
      options.onDone?.()
      return
    }

    const sentence = options.sentences[this.currentIndex]
    const sentenceWords = sentenceWordsFor(sentence, options.words, resumeFromWordIndex)
    const text =
      resumeFromWordIndex !== undefined && sentenceWords.length > 0
        ? sentenceWords.map((w) => w.text).join(' ')
        : options.sentenceTexts[this.currentIndex]?.trim()

    if (!text) {
      this.currentIndex++
      this.lastWordIndex = undefined
      this.speakCurrent()
      return
    }

    const firstWord = sentenceWords[0]
    if (firstWord) {
      this.lastWordIndex = firstWord.globalIndex
      options.onSentence(this.currentIndex, firstWord.globalIndex, firstWord.pageNum)
    } else if (sentence) {
      this.lastWordIndex = sentence.startWordIndex
      options.onSentence(this.currentIndex, sentence.startWordIndex, sentence.pageNum)
    }

    const rate = Math.max(0.1, Math.min(options.speed, 3))
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = findSpeechVoice(options.voice)
    if (voice) utterance.voice = voice
    utterance.rate = rate
    utterance.volume = Math.max(0, Math.min(options.volume, 1))
    this.activeUtterance = utterance

    let nativeBoundaryFired = false
    const scheduleMs = buildSyntheticWordSchedule(sentenceWords, rate)
    let spokenStartTime = 0
    let lastSyntheticIdx = 0

    const startSyntheticProgress = () => {
      if (this.syntheticTimer !== null || nativeBoundaryFired || sentenceWords.length <= 1) return
      spokenStartTime = performance.now()
      this.syntheticTimer = setInterval(() => {
        if (this.cancelled || this.paused || nativeBoundaryFired || this.activeUtterance !== utterance) {
          return
        }
        const elapsed = performance.now() - spokenStartTime
        let nextIdx = lastSyntheticIdx
        while (
          nextIdx + 1 < scheduleMs.length &&
          elapsed >= scheduleMs[nextIdx + 1]
        ) {
          nextIdx++
        }
        if (nextIdx !== lastSyntheticIdx) {
          lastSyntheticIdx = nextIdx
          const word = sentenceWords[nextIdx]
          if (word) {
            this.lastWordIndex = word.globalIndex
            options.onWord(word.globalIndex, word.pageNum)
          }
        }
      }, 45)
    }

    utterance.onstart = () => {
      if (this.cancelled || this.activeUtterance !== utterance) return
      startSyntheticProgress()
    }

    utterance.onboundary = (event) => {
      if (this.cancelled || this.activeUtterance !== utterance || event.name !== 'word') return
      nativeBoundaryFired = true
      this.clearSyntheticTimer()
      const word = wordForBoundary(sentenceWords, event.charIndex)
      if (word) {
        this.lastWordIndex = word.globalIndex
        options.onWord(word.globalIndex, word.pageNum)
      }
    }

    utterance.onerror = (event) => {
      if (this.cancelled || this.paused || this.activeUtterance !== utterance) return
      if (event.error === 'canceled' || event.error === 'interrupted') return
      this.clearSyntheticTimer()
      usePlayerStore.getState().setModelError(`Browser voice failed: ${event.error}`)
    }

    utterance.onend = () => {
      if (this.cancelled || this.paused || this.activeUtterance !== utterance) return
      this.clearSyntheticTimer()
      this.currentIndex++
      this.lastWordIndex = undefined
      this.speakCurrent()
    }

    window.speechSynthesis.speak(utterance)
    // Fallback if onstart is delayed or not emitted on some mobile WebViews
    setTimeout(() => {
      if (!this.cancelled && !this.paused && this.activeUtterance === utterance) {
        startSyntheticProgress()
      }
    }, 120)
  }
}

export const browserSpeech = new BrowserSpeechController()
