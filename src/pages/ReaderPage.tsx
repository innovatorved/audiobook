import { useCallback, useEffect, useRef, useState } from 'react'
import type { PdfScrollerHandle } from '@/components/pdf/PdfScroller'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { PdfScroller } from '@/components/pdf/PdfScroller'
import { ReaderReturnBanner } from '@/components/pdf/ReaderReturnBanner'
import { PlayerBar } from '@/components/player/PlayerBar'
import { LoadingOverlay } from '@/components/ui/LoadingOverlay'
import { Skeleton } from '@/components/ui/skeleton'
import { pdfjs } from '@/lib/pdf/setup'
import { isScannedPdf } from '@/lib/pdf/detect'
import { extractAllDigitalWords } from '@/lib/pdf/extract'
import { clearPageCanvasCache } from '@/lib/pdf/pageCanvasCache'
import { findContentStartSentence } from '@/lib/pdf/findContentStart'
import { buildWordMap } from '@/lib/pipeline/wordMap'
import { getDocument, getMetadata, saveMetadata } from '@/lib/db/index'
import {
  getPreferredVoice,
  loadPreferences,
  rememberVoiceForEngine,
  sanitizeVoiceForEngine,
  savePreferences,
} from '@/lib/preferences'
import { audioScheduler } from '@/lib/audio/scheduler'
import { highlightSync } from '@/lib/audio/highlightSync'
import { useReaderStore } from '@/stores/readerStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useTtsWorker } from '@/hooks/useTtsWorker'
import { findClickTargetAtPoint } from '@/lib/pdf/findWordAtPoint'
import { clearSynthCache, isEngineReady, switchEngine as switchEngineDirect } from '@/lib/tts/ttsWorkerManager'
import { useOcrPrefetch } from '@/hooks/useOcrPrefetch'
import { useReadingProgress } from '@/hooks/useReadingProgress'
import type { TtsEngineType } from '@/lib/types'

function sentenceIndexFromWord(
  words: { globalIndex: number; sentenceIndex: number }[],
  wordIndex: number,
  fallback: number,
): number {
  const word = words.find((w) => w.globalIndex === wordIndex)
  return word?.sentenceIndex ?? fallback
}

export function ReaderPage() {
  const { docId } = useParams<{ docId: string }>()
  const [isLoading, setIsLoading] = useState(true)
  const [visiblePage, setVisiblePage] = useState(1)
  const [initialPage, setInitialPage] = useState<number | undefined>(undefined)
  const [followResetKey, setFollowResetKey] = useState(0)
  const [userNavigatedAway, setUserNavigatedAway] = useState(false)
  const streamingRef = useRef(false)
  const playbackGenRef = useRef(0)
  const streamGenRef = useRef(0)
  const streamStartWordRef = useRef<{ sentenceIndex: number; wordIndex: number } | null>(null)
  const seekCoalesceRef = useRef<{
    index: number
    autoPlay: boolean
    wordIndex?: number
  } | null>(null)
  const savedProgressRef = useRef<{
    wordIndex: number
    pageNum: number
    sentenceIndex: number
  } | null>(null)
  const progressAppliedRef = useRef(false)
  const ocrPrefetchSeededRef = useRef(false)
  const lastDocIdRef = useRef<string | undefined>(undefined)
  const pdfScrollerRef = useRef<PdfScrollerHandle | null>(null)
  const userSeekInProgressRef = useRef(false)
  const pendingClickRef = useRef<{ index: number; wordIndex?: number } | null>(null)
  const pendingPageClickRef = useRef<{ pageNum: number; x: number; y: number } | null>(null)

  const {
    docName,
    pdfDoc,
    totalPages,
    isScanned,
    words,
    sentences,
    sentenceTexts,
    isExtracting,
    setDocument,
    setScanned,
    setWords,
    setExtracting,
    reset: resetReader,
  } = useReaderStore()

  const {
    isPlaying,
    isModelReady,
    isModelLoading,
    setPlaying,
    speed,
    setSpeed,
    engine,
    voice,
    setVoice,
    activeWordIndex,
    activePageNum,
    currentSentenceIndex,
    modelError,
    setActiveWord,
    setSentenceIndex,
    setTotalSentences,
    reset: resetPlayer,
  } = usePlayerStore()

  const { loadEngine, switchEngine, startStream, stopStream, prefetchSynth } = useTtsWorker()
  const { prefetchAround, ocrPage } = useOcrPrefetch()
  const { persist, restoreProgress } = useReadingProgress()

  const activeWord = words.find((w) => w.globalIndex === activeWordIndex) ?? null

  const currentSentence = sentences[currentSentenceIndex]
  const activeSentence = (() => {
    if (activeWordIndex >= 0) {
      return (
        sentences.find(
          (s) =>
            activeWordIndex >= s.startWordIndex && activeWordIndex <= s.endWordIndex,
        ) ?? currentSentence
      )
    }
    return currentSentence
  })()
  const activeSentenceWords = activeSentence
    ? words.filter(
        (w) =>
          w.globalIndex >= activeSentence.startWordIndex &&
          w.globalIndex <= activeSentence.endWordIndex,
      )
    : []

  const applySavedProgress = useCallback(
    (progress: { wordIndex: number; pageNum: number; sentenceIndex: number }) => {
      const targetWord = words.find((w) => w.globalIndex === progress.wordIndex)
      if (!targetWord) return

      setSentenceIndex(targetWord.sentenceIndex)
      setActiveWord(targetWord.globalIndex, targetWord.pageNum)
      setInitialPage(targetWord.pageNum)
      progressAppliedRef.current = true
    },
    [words, setSentenceIndex, setActiveWord],
  )

  const applyContentStart = useCallback(
    (sents: { pageNum: number; startWordIndex: number; text: string }[]) => {
      const sentenceIdx = findContentStartSentence(sents)
      const sentence = sents[sentenceIdx]
      if (sentence) {
        setSentenceIndex(sentenceIdx)
        setActiveWord(sentence.startWordIndex, sentence.pageNum)
        setInitialPage(sentence.pageNum)
      }
    },
    [setSentenceIndex, setActiveWord],
  )

  useEffect(() => {
    if (!docId) return

    let cancelled = false
    resetReader()
    resetPlayer()
    clearPageCanvasCache()
    if (lastDocIdRef.current !== docId) {
      lastDocIdRef.current = docId
      setIsLoading(true)
      setInitialPage(undefined)
    }
    progressAppliedRef.current = false
    ocrPrefetchSeededRef.current = false
    savedProgressRef.current = null

    void (async () => {
      try {
        const doc = await getDocument(docId)
        if (!doc || cancelled) return

        const buffer = await doc.pdfBlob.arrayBuffer()
        const loadingTask = pdfjs.getDocument({ data: buffer })
        const pdf = await loadingTask.promise
        if (cancelled) return

        setDocument(docId, doc.name, pdf)

        const prefs = loadPreferences()
        const activeEngine = prefs.engine
        const metadata = await getMetadata(docId)
        if (metadata) {
          const safeVoice = sanitizeVoiceForEngine(metadata.voice, activeEngine)
          rememberVoiceForEngine(activeEngine, safeVoice)
          usePlayerStore.setState({
            voice: safeVoice,
            speed: metadata.speed ?? prefs.speed,
            engine: activeEngine,
          })
        } else {
          usePlayerStore.setState({
            engine: activeEngine,
            voice: prefs.voiceByEngine[activeEngine] ?? getPreferredVoice(activeEngine),
            speed: prefs.speed,
          })
        }

        const progress = await restoreProgress(docId)
        if (progress) {
          savedProgressRef.current = {
            wordIndex: progress.wordIndex,
            pageNum: progress.pageNum,
            sentenceIndex: progress.sentenceIndex,
          }
        }

        setExtracting(true, 0)
        const rawWords = await extractAllDigitalWords(pdf)
        const pagesWithText = new Set(rawWords.map((w) => w.pageNum)).size
        const heuristicScanned = await isScannedPdf(pdf)
        const scanned = rawWords.length === 0 && heuristicScanned
        setScanned(scanned)

        if (scanned) {
          toast.info('Scanned PDF detected — OCR may be slower')
          setExtracting(true, 0)
        } else {
          const { words: mapped, sentences: sents } = buildWordMap(rawWords)
          const texts = sents.map((s) => s.text)
          setWords(mapped, sents, texts)
          setTotalSentences(texts.length)
          setExtracting(false, 100)

          if (progress && !cancelled) {
            applySavedProgress(progress)
          } else if (!cancelled) {
            applyContentStart(sents)
          }
        }

        if (!isEngineReady(activeEngine)) {
          loadEngine(activeEngine)
        }
        setIsLoading(false)
      } catch {
        toast.error('Failed to load document')
        setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
      stopStream()
      audioScheduler.clear()
      highlightSync.clear()
    }
    // Intentionally only re-runs when docId changes; store setters and helpers
    // are stable callbacks bound to this component scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  useEffect(() => {
    if (progressAppliedRef.current || !savedProgressRef.current) return
    applySavedProgress(savedProgressRef.current)
  }, [words, applySavedProgress])

  useEffect(() => {
    if (!isScanned || !pdfDoc || ocrPrefetchSeededRef.current) return
    ocrPrefetchSeededRef.current = true
    const seedPage = savedProgressRef.current?.pageNum ?? 1
    if (savedProgressRef.current) {
      setInitialPage(savedProgressRef.current.pageNum)
    }
    prefetchAround(seedPage)
  }, [isScanned, pdfDoc, prefetchAround])

  useEffect(() => {
    if (!isScanned || !pdfDoc || !ocrPrefetchSeededRef.current) return
    prefetchAround(visiblePage)
  }, [isScanned, pdfDoc, visiblePage, prefetchAround])

  useEffect(() => {
    if (sentenceTexts.length > 0) {
      setTotalSentences(sentenceTexts.length)
    }
  }, [sentenceTexts.length, setTotalSentences])

  useEffect(() => {
    if (!isModelReady || isPlaying || words.length === 0 || sentenceTexts.length === 0) return
    const timer = window.setTimeout(() => {
      const indices = [
        ...new Set(words.filter((w) => w.pageNum === visiblePage).map((w) => w.sentenceIndex)),
      ]
        .sort((a, b) => a - b)
        .slice(0, 3)
      const texts = indices
        .map((index) => sentenceTexts[index])
        .filter((text): text is string => Boolean(text?.trim()))
      if (texts.length > 0) {
        prefetchSynth(texts)
      }
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [visiblePage, isModelReady, isPlaying, words, sentenceTexts, prefetchSynth])

  useEffect(() => {
    const warmAudio = () => {
      void audioScheduler.ensureContext()
    }
    window.addEventListener('pointerdown', warmAudio, { once: true })
    return () => window.removeEventListener('pointerdown', warmAudio)
  }, [])

  useEffect(() => {
    audioScheduler.setPlaybackRate(speed)
    highlightSync.seekToTime(audioScheduler.getCurrentTime())
  }, [speed])

  useEffect(() => {
    audioScheduler.onSentenceScheduled((sentence) => {
      setSentenceIndex(sentence.sentenceIndex)
    })
  }, [setSentenceIndex])

  const getResumeSentenceIndex = useCallback(() => {
    if (activeWordIndex >= 0 && words.length > 0) {
      return sentenceIndexFromWord(words, activeWordIndex, currentSentenceIndex)
    }
    return currentSentenceIndex
  }, [activeWordIndex, words, currentSentenceIndex])

  const handleAudioChunk = useCallback(
    async (chunk: {
      text: string
      pcm: Float32Array
      sampleRate: number
      sentenceIndex: number
    }) => {
      if (streamGenRef.current !== playbackGenRef.current) {
        return
      }

      const sentence = sentences[chunk.sentenceIndex]
      const sentenceWords = sentence
        ? words.filter(
            (w) =>
              w.globalIndex >= sentence.startWordIndex &&
              w.globalIndex <= sentence.endWordIndex,
          )
        : []

      const sliceFrom = streamStartWordRef.current
      let timingWords = sentenceWords
      if (sliceFrom && chunk.sentenceIndex === sliceFrom.sentenceIndex) {
        timingWords = sentenceWords.filter((w) => w.globalIndex >= sliceFrom.wordIndex)
        streamStartWordRef.current = null
      }

      const { startTime, duration } = await audioScheduler.enqueueAudio(chunk.pcm, chunk.sampleRate, {
        sentenceIndex: chunk.sentenceIndex,
        words: timingWords.length > 0 ? timingWords : sentenceWords,
      })

      if (duration <= 0 || streamGenRef.current !== playbackGenRef.current) {
        if (
          duration <= 0 &&
          usePlayerStore.getState().isPlaying &&
          !userSeekInProgressRef.current
        ) {
          setPlaying(false)
        }
        return
      }

      if (userSeekInProgressRef.current) {
        userSeekInProgressRef.current = false
      }

      if (streamingRef.current && !userSeekInProgressRef.current) {
        const upcoming = [sentenceTexts[chunk.sentenceIndex + 1]].filter((t): t is string =>
          Boolean(t?.trim()),
        )
        if (upcoming.length > 0) {
          prefetchSynth(upcoming)
        }
      }

      highlightSync.registerSentenceTiming(
        timingWords.length > 0 ? timingWords : sentenceWords,
        startTime,
        duration,
      )

    },
    [sentences, words, sentenceTexts, prefetchSynth, setPlaying],
  )

  const beginStream = useCallback(
    async (fromIndex: number, fromWordIndex?: number) => {
      if (sentenceTexts.length === 0) return
      streamGenRef.current = playbackGenRef.current
      streamStartWordRef.current =
        fromWordIndex !== undefined ? { sentenceIndex: fromIndex, wordIndex: fromWordIndex } : null
      streamingRef.current = true
      audioScheduler.clear()
      audioScheduler.beginScheduling()
      highlightSync.clear()
      setSentenceIndex(fromIndex)

      const ctx = audioScheduler.getContext()
      if (ctx) {
        highlightSync.setContext(ctx)
        highlightSync.setBaseOffset(audioScheduler.getTimelineBase())
      }

      highlightSync.onWord((wordIndex, pageNum) => {
        if (streamGenRef.current !== playbackGenRef.current) return
        setActiveWord(wordIndex, pageNum)
        setSentenceIndex(sentenceIndexFromWord(words, wordIndex, fromIndex))
      })

      const streamTexts = [...sentenceTexts]
      if (fromWordIndex !== undefined) {
        const sentence = sentences[fromIndex]
        const isMidSentence =
          sentence !== undefined && fromWordIndex > sentence.startWordIndex
        if (isMidSentence) {
          const sliceWords = words.filter(
            (w) =>
              w.globalIndex >= fromWordIndex &&
              w.globalIndex <= sentence.endWordIndex,
          )
          if (sliceWords.length > 0) {
            const sliceText = sliceWords.map((w) => w.text).join(' ').trim()
            if (sliceText.length > 0) {
              streamTexts[fromIndex] = sliceText
            } else {
              streamStartWordRef.current = null
            }
          }
        }
      }

      await audioScheduler.play()
      await startStream(streamTexts, fromIndex, handleAudioChunk)
    },
    [sentenceTexts, sentences, words, startStream, handleAudioChunk, setSentenceIndex, setActiveWord],
  )

  const startHighlightSync = useCallback(() => {
    const ctx = audioScheduler.getContext()
    if (!ctx) return
    highlightSync.setContext(ctx)
    highlightSync.setBaseOffset(audioScheduler.getTimelineBase())
    highlightSync.seekToTime(audioScheduler.getCurrentTime())
    highlightSync.start()
  }, [])

  const resetFollowHighlight = useCallback(() => {
    setFollowResetKey((k) => k + 1)
  }, [])

  const pausePlayback = useCallback(async () => {
    if (!usePlayerStore.getState().isPlaying) return
    playbackGenRef.current++
    stopStream()
    streamingRef.current = false
    await audioScheduler.pause()
    highlightSync.pause()
    setPlaying(false)
    void persist()
  }, [stopStream, setPlaying, persist])

  const handleUserNavigate = useCallback(() => {
    if (userSeekInProgressRef.current) {
      return
    }
    pdfScrollerRef.current?.lockUserScroll()
    setUserNavigatedAway(true)
    void pausePlayback()
  }, [pausePlayback])

  const startFromSentence = useCallback(
    async (index: number, autoPlay: boolean, wordIndex?: number) => {
      const isUserClick = wordIndex !== undefined
      if (isUserClick) {
        userSeekInProgressRef.current = true
        pdfScrollerRef.current?.lockUserScroll()
        setUserNavigatedAway(false)
      }

      playbackGenRef.current++
      const gen = playbackGenRef.current
      const clickedWord = wordIndex !== undefined ? words.find((w) => w.globalIndex === wordIndex) : null
      const clamped = Math.max(
        0,
        Math.min(clickedWord?.sentenceIndex ?? index, sentenceTexts.length - 1),
      )

      if (clickedWord) {
        setActiveWord(clickedWord.globalIndex, clickedWord.pageNum)
      } else {
        const sentence = sentences[clamped]
        if (sentence) {
          setActiveWord(sentence.startWordIndex, sentence.pageNum)
        }
      }
      setSentenceIndex(clamped)

      stopStream()
      streamingRef.current = false
      if (isUserClick && autoPlay) {
        audioScheduler.clear()
        highlightSync.pause()
        highlightSync.clear()
      } else {
        await audioScheduler.pause()
        highlightSync.pause()
        audioScheduler.clear()
        highlightSync.clear()
      }

      if (gen !== playbackGenRef.current) {
        if (isUserClick) userSeekInProgressRef.current = false
        return
      }

      if (!isUserClick) {
        resetFollowHighlight()
      }

      if (clickedWord) {
        pdfScrollerRef.current?.scrollToPage(clickedWord.pageNum, {
          onlyIfOffscreen: isUserClick,
        })
      } else {
        const sentence = sentences[clamped]
        if (sentence) {
          pdfScrollerRef.current?.scrollToPage(sentence.pageNum, {
            onlyIfOffscreen: isUserClick,
          })
        }
      }

      const activeEngine = usePlayerStore.getState().engine
      const engineReady = isEngineReady(activeEngine)
      if (!autoPlay || !engineReady) {
        if (autoPlay) {
          pendingClickRef.current = { index: clamped, wordIndex: clickedWord?.globalIndex }
          void switchEngineDirect(activeEngine)
        } else {
          await audioScheduler.pause()
          setPlaying(false)
          void persist()
        }
        if (isUserClick) userSeekInProgressRef.current = false
        return
      }

      pendingClickRef.current = null

      if (gen !== playbackGenRef.current) {
        if (isUserClick) userSeekInProgressRef.current = false
        return
      }

      setPlaying(true)
      await audioScheduler.ensureContext()
      const fromWord = clickedWord?.globalIndex

      await beginStream(clamped, fromWord)
      if (gen !== playbackGenRef.current) {
        if (isUserClick) userSeekInProgressRef.current = false
        return
      }
      startHighlightSync()
      void persist()
    },
    [
      sentenceTexts.length,
      sentences,
      words,
      isModelReady,
      stopStream,
      beginStream,
      startHighlightSync,
      setActiveWord,
      setSentenceIndex,
      setPlaying,
      persist,
      resetFollowHighlight,
    ],
  )

  useEffect(() => {
    const pending = pendingClickRef.current
    if (!pending || !isEngineReady(engine)) return
    pendingClickRef.current = null
    void startFromSentence(pending.index, true, pending.wordIndex)
  }, [isModelReady, engine, startFromSentence])

  const handlePlayPause = useCallback(async () => {
    if (!isModelReady || !isEngineReady(engine)) {
      if (!isModelLoading) {
        void switchEngine(engine)
      }
      toast.info('Loading voice model…', {
        description: 'Visit Home first to preload, or wait for the model to finish downloading.',
      })
      return
    }

    if (sentenceTexts.length === 0) {
      toast.error('No text found in this PDF', {
        description: 'Try a digital PDF or wait for OCR to finish on scanned documents.',
      })
      return
    }

    if (isPlaying) {
      playbackGenRef.current++
      stopStream()
      streamingRef.current = false
      await audioScheduler.pause()
      highlightSync.pause()
      setPlaying(false)
      void persist()
    } else {
      await startFromSentence(getResumeSentenceIndex(), true)
    }
  }, [
    isPlaying,
    isModelReady,
    isModelLoading,
    engine,
    sentenceTexts,
    getResumeSentenceIndex,
    setPlaying,
    stopStream,
    persist,
    startFromSentence,
  ])

  useEffect(() => {
    if (modelError) {
      toast.error('Voice playback failed', { description: modelError })
    }
  }, [modelError])

  const scheduleSeek = useCallback(
    (index: number, autoPlay: boolean, wordIndex?: number) => {
      seekCoalesceRef.current = { index, autoPlay, wordIndex }
      queueMicrotask(() => {
        const pending = seekCoalesceRef.current
        if (!pending) return
        seekCoalesceRef.current = null
        void startFromSentence(pending.index, pending.autoPlay, pending.wordIndex)
      })
    },
    [startFromSentence],
  )

  useEffect(() => {
    const pending = pendingPageClickRef.current
    if (!pending) return
    const pageWords = words.filter((w) => w.pageNum === pending.pageNum)
    if (pageWords.length === 0) return
    const word = findClickTargetAtPoint(pageWords, pending.x, pending.y)
    if (!word) return
    pendingPageClickRef.current = null
    scheduleSeek(word.sentenceIndex, true, word.globalIndex)
  }, [words, scheduleSeek])

  const handleSeek = useCallback(
    (index: number) => {
      scheduleSeek(index, isPlaying)
    },
    [scheduleSeek, isPlaying],
  )

  const handleReturnToPlayback = useCallback(() => {
    const targetPage = activePageNum > 0 ? activePageNum : visiblePage
    if (targetPage > 0) {
      pdfScrollerRef.current?.scrollToPage(targetPage)
    }
    setUserNavigatedAway(false)
    resetFollowHighlight()
  }, [activePageNum, visiblePage, resetFollowHighlight])

  useEffect(() => {
    if (activePageNum > 0 && visiblePage === activePageNum) {
      setUserNavigatedAway(false)
    }
  }, [visiblePage, activePageNum])

  const visiblePageWordCount = words.filter((w) => w.pageNum === visiblePage).length
  const playbackPage = activePageNum > 0 ? activePageNum : 0
  const scrolledPastPlayback = playbackPage > 0 && visiblePage > playbackPage
  const onEmptyPageAhead =
    playbackPage > 0 &&
    visiblePage > playbackPage &&
    visiblePageWordCount === 0
  const showReturnBanner =
    userNavigatedAway && playbackPage > 0 && (scrolledPastPlayback || onEmptyPageAhead)
  const returnBannerReason: 'empty' | 'away' = onEmptyPageAhead ? 'empty' : 'away'

  const handleEmptyPageClick = useCallback(
    (pageNum: number, x: number, y: number) => {
      pendingPageClickRef.current = { pageNum, x, y }
      pdfScrollerRef.current?.scrollToPage(pageNum)
      if (isScanned) {
        void ocrPage(pageNum)
        prefetchAround(pageNum)
        toast.info(`Recognizing text on page ${pageNum}…`, {
          description: 'Playback will start when OCR finishes.',
        })
      } else {
        toast.info(`No selectable text on page ${pageNum}`, {
          description: 'This page may be a figure or blank spread in an otherwise digital PDF.',
        })
      }
    },
    [isScanned, ocrPage, prefetchAround],
  )

  const handleLineClick = useCallback(
    (sentenceIndex: number, wordIndex: number) => {
      userSeekInProgressRef.current = true
      scheduleSeek(sentenceIndex, true, wordIndex)
    },
    [scheduleSeek],
  )

  const handleVoiceChange = useCallback(
    (newVoice: string) => {
      clearSynthCache()
      setVoice(newVoice)
      rememberVoiceForEngine(usePlayerStore.getState().engine, newVoice)

      if (docId) {
        void saveMetadata({
          docId,
          isScanned,
          totalPages,
          voice: newVoice,
          speed: usePlayerStore.getState().speed,
          engine: usePlayerStore.getState().engine,
        })
      }

      if (!isPlaying) return

      const resumeIndex = getResumeSentenceIndex()
      streamingRef.current = false
      stopStream()
      audioScheduler.clear()
      highlightSync.clear()
      resetFollowHighlight()

      const sentence = sentences[resumeIndex]
      if (sentence) {
        setActiveWord(sentence.startWordIndex, sentence.pageNum)
      }
      setSentenceIndex(resumeIndex)
      void startFromSentence(resumeIndex, true)
    },
    [
      startFromSentence,
      setVoice,
      docId,
      isScanned,
      totalPages,
      isPlaying,
      getResumeSentenceIndex,
      stopStream,
      sentences,
      setActiveWord,
      setSentenceIndex,
      resetFollowHighlight,
    ],
  )

  const handleSkipBack = useCallback(() => {
    handleSeek(currentSentenceIndex - 1)
  }, [currentSentenceIndex, handleSeek])

  const handleSkipForward = useCallback(() => {
    handleSeek(currentSentenceIndex + 1)
  }, [currentSentenceIndex, handleSeek])

  const handleSpeedChange = useCallback(
    (newSpeed: number) => {
      clearSynthCache()
      setSpeed(newSpeed)
      savePreferences({ speed: newSpeed })
      audioScheduler.setPlaybackRate(newSpeed)

      if (docId) {
        void saveMetadata({
          docId,
          isScanned,
          totalPages,
          voice: usePlayerStore.getState().voice,
          speed: newSpeed,
          engine: usePlayerStore.getState().engine,
        })
      }
    },
    [setSpeed, docId, isScanned, totalPages],
  )

  const handleEngineChange = useCallback(
    (newEngine: TtsEngineType) => {
      const prev = usePlayerStore.getState()
      rememberVoiceForEngine(prev.engine, prev.voice)
      streamingRef.current = false
      stopStream()
      void switchEngine(newEngine)
      if (docId) {
        void saveMetadata({
          docId,
          isScanned,
          totalPages,
          voice: getPreferredVoice(newEngine),
          speed: prev.speed,
          engine: newEngine,
        })
      }
    },
    [stopStream, docId, isScanned, totalPages],
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          void handlePlayPause()
          break
        case 'ArrowLeft':
          e.preventDefault()
          handleSkipBack()
          break
        case 'ArrowRight':
          e.preventDefault()
          handleSkipForward()
          break
        case 'ArrowUp':
          e.preventDefault()
          handleSpeedChange(Math.min(4.5, speed + 0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          handleSpeedChange(Math.max(0.5, speed - 0.1))
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlePlayPause, handleSkipBack, handleSkipForward, handleSpeedChange, speed])

  if (isLoading || !pdfDoc) {
    return (
      <div className="relative flex h-screen flex-col overflow-hidden bg-background">
        <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
          <Skeleton className="size-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="reader-canvas flex-1 space-y-8 overflow-y-auto px-6 py-8 sm:px-8">
          <Skeleton className="mx-auto h-[520px] max-w-4xl rounded-xl" />
          <Skeleton className="mx-auto h-[520px] max-w-4xl rounded-xl" />
        </div>
        <LoadingOverlay message="Loading PDF…" />
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <TopBar
        title={docName}
        pageIndicator={`Page ${activePageNum} of ${totalPages}`}
        onEngineChange={handleEngineChange}
        onVoiceChange={handleVoiceChange}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isExtracting && isScanned && (
          <LoadingOverlay message="Running OCR on pages…" />
        )}
        <PdfScroller
          pdfDoc={pdfDoc}
          totalPages={totalPages}
          activeWord={activeWord}
          activeSentenceWords={activeSentenceWords}
          activePageNum={activePageNum}
          followHighlight={isPlaying}
          initialPage={initialPage}
          resetFollowKey={followResetKey}
          onVisiblePageChange={setVisiblePage}
          onUserNavigate={handleUserNavigate}
          suppressUserNavigateRef={userSeekInProgressRef}
          onLineClick={handleLineClick}
          onEmptyPageClick={handleEmptyPageClick}
          onReturnToPlayback={handleReturnToPlayback}
          playbackPageNum={playbackPage}
          words={words}
          scrollerRef={pdfScrollerRef}
        />
      </div>

      {showReturnBanner && (
        <ReaderReturnBanner
          visiblePage={visiblePage}
          playbackPage={playbackPage}
          reason={returnBannerReason}
          onReturn={handleReturnToPlayback}
        />
      )}

      <PlayerBar
        onPlayPause={() => void handlePlayPause()}
        onSkipBack={handleSkipBack}
        onSkipForward={handleSkipForward}
        onScrub={handleSeek}
      />
    </div>
  )
}
