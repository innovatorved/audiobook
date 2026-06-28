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
  return words.filter(
    (word) =>
      word.globalIndex >= sentence.startWordIndex &&
      word.globalIndex <= sentence.endWordIndex &&
      (startWordIndex === undefined || word.globalIndex >= startWordIndex),
  )
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

class BrowserSpeechController {
  private options: BrowserSpeechOptions | null = null
  private currentIndex = 0
  private cancelled = false
  private paused = false

  play(options: BrowserSpeechOptions): void {
    this.cancel()
    if (!browserTtsSupported()) {
      usePlayerStore.getState().setModelError('Browser text-to-speech is not available in this browser.')
      return
    }
    this.options = options
    this.currentIndex = Math.max(0, Math.min(options.startIndex, options.sentenceTexts.length - 1))
    this.cancelled = false
    this.paused = false
    this.speakCurrent()
  }

  pause(): void {
    if (!browserTtsSupported()) return
    this.paused = true
    window.speechSynthesis.pause()
  }

  resume(): void {
    if (!browserTtsSupported()) return
    this.paused = false
    window.speechSynthesis.resume()
  }

  cancel(): void {
    this.cancelled = true
    this.paused = false
    if (browserTtsSupported()) window.speechSynthesis.cancel()
  }

  private speakCurrent(): void {
    const options = this.options
    if (!options || this.cancelled) return
    if (this.currentIndex >= options.sentenceTexts.length) {
      options.onDone?.()
      return
    }

    const text = options.sentenceTexts[this.currentIndex]?.trim()
    if (!text) {
      this.currentIndex++
      this.speakCurrent()
      return
    }

    const sentence = options.sentences[this.currentIndex]
    const sentenceWords = sentenceWordsFor(
      sentence,
      options.words,
      this.currentIndex === options.startIndex ? options.startWordIndex : undefined,
    )
    const firstWord = sentenceWords[0]
    if (firstWord) {
      options.onSentence(this.currentIndex, firstWord.globalIndex, firstWord.pageNum)
    } else if (sentence) {
      options.onSentence(this.currentIndex, sentence.startWordIndex, sentence.pageNum)
    }

    const utterance = new SpeechSynthesisUtterance(text)
    const voice = findSpeechVoice(options.voice)
    if (voice) utterance.voice = voice
    utterance.rate = Math.max(0.1, Math.min(options.speed, 3))
    utterance.volume = Math.max(0, Math.min(options.volume, 1))

    utterance.onboundary = (event) => {
      if (this.cancelled || event.name !== 'word') return
      const word = wordForBoundary(sentenceWords, event.charIndex)
      if (word) options.onWord(word.globalIndex, word.pageNum)
    }

    utterance.onerror = (event) => {
      if (this.cancelled) return
      usePlayerStore.getState().setModelError(`Browser voice failed: ${event.error}`)
    }

    utterance.onend = () => {
      if (this.cancelled || this.paused) return
      this.currentIndex++
      this.speakCurrent()
    }

    window.speechSynthesis.speak(utterance)
  }
}

export const browserSpeech = new BrowserSpeechController()
