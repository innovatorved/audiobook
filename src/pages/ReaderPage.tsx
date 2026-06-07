import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { PdfScroller } from '@/components/pdf/PdfScroller'
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
import { audioScheduler } from '@/lib/audio/scheduler'
import { highlightSync } from '@/lib/audio/highlightSync'
import { useReaderStore } from '@/stores/readerStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useTtsWorker } from '@/hooks/useTtsWorker'
import { preloadEngine } from '@/lib/tts/ttsWorkerManager'
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
  const streamingRef = useRef(false)
  const playbackGenRef = useRef(0)
  const streamGenRef = useRef(0)
  const streamStartWordRef = useRef<{ sentenceIndex: number; wordIndex: number } | null>(null)
  const savedProgressRef = useRef<{
    wordIndex: number
    pageNum: number
    sentenceIndex: number
  } | null>(null)
  const progressAppliedRef = useRef(false)
  const ocrPrefetchSeededRef = useRef(false)

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

  const { loadEngine, switchEngine, startStream, stopStream, prefetch, invalidatePrefetch } =
    useTtsWorker()
  const { prefetchAround } = useOcrPrefetch()
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
    setIsLoading(true)
    progressAppliedRef.current = false
    ocrPrefetchSeededRef.current = false
    savedProgressRef.current = null
    setInitialPage(undefined)

    void (async () => {
      try {
        const doc = await getDocument(docId)
        if (!doc || cancelled) return

        const buffer = await doc.pdfBlob.arrayBuffer()
        const loadingTask = pdfjs.getDocument({ data: buffer })
        const pdf = await loadingTask.promise
        if (cancelled) return

        setDocument(docId, doc.name, pdf)

        const scanned = await isScannedPdf(pdf)
        setScanned(scanned)

        const metadata = await getMetadata(docId)
        if (metadata) {
          usePlayerStore.setState({
            voice: metadata.voice,
            speed: metadata.speed,
            engine: metadata.engine,
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

        if (scanned) {
          toast.info('Scanned PDF detected — OCR may be slower')
          setExtracting(true, 0)
        } else {
          setExtracting(true, 0)
          const rawWords = await extractAllDigitalWords(pdf)
          const { words: mapped, sentences: sents, fullText: _ft } = buildWordMap(rawWords)
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

        loadEngine(metadata?.engine ?? engine ?? 'kitten')
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

  useEffect(() => {
    if (!isModelReady || isPlaying || sentenceTexts.length === 0) return

    const resumeIndex = getResumeSentenceIndex()
    const text = sentenceTexts[resumeIndex]
    if (text) {
      prefetch(resumeIndex, text)
    }
  }, [
    isModelReady,
    isPlaying,
    sentenceTexts,
    currentSentenceIndex,
    activeWordIndex,
    voice,
    speed,
    getResumeSentenceIndex,
    prefetch,
  ])

  const handleAudioChunk = useCallback(
    async (chunk: {
      text: string
      pcm: Float32Array
      sampleRate: number
      sentenceIndex: number
    }) => {
      if (streamGenRef.current !== playbackGenRef.current) return

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

      if (duration <= 0 || streamGenRef.current !== playbackGenRef.current) return

      highlightSync.registerSentenceTiming(
        timingWords.length > 0 ? timingWords : sentenceWords,
        startTime,
        duration,
      )

      const nextIdx = chunk.sentenceIndex + 1
      const nextText = sentenceTexts[nextIdx]
      if (nextText) {
        prefetch(nextIdx, nextText)
      }
    },
    [sentences, words, sentenceTexts, prefetch],
  )

  const beginStream = useCallback(
    async (fromIndex: number, fromWordIndex?: number) => {
      if (sentenceTexts.length === 0) return
      streamGenRef.current = playbackGenRef.current
      streamStartWordRef.current =
        fromWordIndex !== undefined ? { sentenceIndex: fromIndex, wordIndex: fromWordIndex } : null
      streamingRef.current = true
      stopStream()
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
        setActiveWord(wordIndex, pageNum)
        setSentenceIndex(sentenceIndexFromWord(words, wordIndex, fromIndex))
      })

      const streamTexts = [...sentenceTexts]
      if (fromWordIndex !== undefined) {
        const sentence = sentences[fromIndex]
        if (sentence) {
          const sliceWords = words.filter(
            (w) =>
              w.globalIndex >= fromWordIndex &&
              w.globalIndex <= sentence.endWordIndex,
          )
          if (sliceWords.length > 0) {
            streamTexts[fromIndex] = sliceWords.map((w) => w.text).join(' ')
          }
        }
      }

      await startStream(streamTexts, fromIndex, handleAudioChunk)
    },
    [sentenceTexts, sentences, words, startStream, stopStream, handleAudioChunk, setSentenceIndex, setActiveWord],
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

  const startFromSentence = useCallback(
    async (index: number, autoPlay: boolean, wordIndex?: number) => {
      playbackGenRef.current++
      const gen = playbackGenRef.current
      const clickedWord = wordIndex !== undefined ? words.find((w) => w.globalIndex === wordIndex) : null
      const clamped = Math.max(
        0,
        Math.min(clickedWord?.sentenceIndex ?? index, sentenceTexts.length - 1),
      )
      stopStream()
      streamingRef.current = false
      await audioScheduler.pause()
      highlightSync.pause()
      audioScheduler.clear()
      highlightSync.clear()
      resetFollowHighlight()

      if (clickedWord) {
        setActiveWord(clickedWord.globalIndex, clickedWord.pageNum)
      } else {
        const sentence = sentences[clamped]
        if (sentence) {
          setActiveWord(sentence.startWordIndex, sentence.pageNum)
        }
      }
      setSentenceIndex(clamped)

      if (!autoPlay || !isModelReady) {
        setPlaying(false)
        void persist()
        return
      }

      if (gen !== playbackGenRef.current) return

      setPlaying(true)
      await audioScheduler.ensureContext()
      const fromWord = clickedWord?.globalIndex
      await beginStream(clamped, fromWord)
      if (gen !== playbackGenRef.current) return
      await audioScheduler.play()
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

  const handlePlayPause = useCallback(async () => {
    if (!isModelReady) {
      if (!isModelLoading) {
        preloadEngine(engine)
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
    activeWordIndex,
    stopStream,
    persist,
    startFromSentence,
  ])

  useEffect(() => {
    if (modelError) {
      toast.error('Voice playback failed', { description: modelError })
    }
  }, [modelError])

  const handleSeek = useCallback(
    (index: number) => {
      void startFromSentence(index, isPlaying)
    },
    [startFromSentence, isPlaying],
  )

  const handleLineClick = useCallback(
    (sentenceIndex: number, wordIndex: number) => {
      void startFromSentence(sentenceIndex, true, wordIndex)
    },
    [startFromSentence],
  )

  const handleVoiceChange = useCallback(
    (newVoice: string) => {
      invalidatePrefetch()
      setVoice(newVoice)

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
      invalidatePrefetch,
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
      beginStream,
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
      invalidatePrefetch()
      setSpeed(newSpeed)
      audioScheduler.setPlaybackRate(newSpeed)
    },
    [setSpeed, invalidatePrefetch],
  )

  const handleEngineChange = useCallback(
    (newEngine: TtsEngineType) => {
      streamingRef.current = false
      stopStream()
      switchEngine(newEngine)
      if (docId) {
        void saveMetadata({
          docId,
          isScanned,
          totalPages,
          voice: usePlayerStore.getState().voice,
          speed: usePlayerStore.getState().speed,
          engine: newEngine,
        })
      }
    },
    [switchEngine, stopStream, docId, isScanned, totalPages],
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
          <Skeleton className="mx-auto h-[520px] max-w-3xl rounded-sm bg-white/80 shadow-sm" />
          <Skeleton className="mx-auto h-[520px] max-w-3xl rounded-sm bg-white/80 shadow-sm" />
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
        {!isModelReady && isModelLoading && (
          <LoadingOverlay message="Loading voice model…" />
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
          onLineClick={handleLineClick}
          words={words}
        />
      </div>

      <PlayerBar
        onPlayPause={() => void handlePlayPause()}
        onSkipBack={handleSkipBack}
        onSkipForward={handleSkipForward}
        onScrub={handleSeek}
      />
    </div>
  )
}
