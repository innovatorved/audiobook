import { useCallback, useEffect, useRef } from 'react'
import { saveProgress, getProgress } from '@/lib/db/index'
import { useReaderStore } from '@/stores/readerStore'
import { usePlayerStore } from '@/stores/playerStore'

const SAVE_INTERVAL_MS = 5000

export function useReadingProgress() {
  const { docId, words } = useReaderStore()
  const { activeWordIndex, activePageNum, currentSentenceIndex } = usePlayerStore()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const persist = useCallback(async () => {
    if (!docId || activeWordIndex < 0) return

    const word = words.find((w) => w.globalIndex === activeWordIndex)
    const sentenceIndex = word?.sentenceIndex ?? currentSentenceIndex

    await saveProgress({
      docId,
      pageNum: activePageNum,
      wordIndex: activeWordIndex,
      sentenceIndex,
      timestamp: Date.now(),
    })
  }, [docId, activePageNum, activeWordIndex, currentSentenceIndex, words])

  useEffect(() => {
    if (!docId) return

    intervalRef.current = setInterval(() => {
      void persist()
    }, SAVE_INTERVAL_MS)

    const handleUnload = () => {
      void persist()
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('beforeunload', handleUnload)
      void persist()
    }
  }, [docId, persist])

  const restoreProgress = useCallback(async (id: string) => {
    const progress = await getProgress(id)
    return progress
  }, [])

  return { persist, restoreProgress }
}
