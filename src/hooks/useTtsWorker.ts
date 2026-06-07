import { useCallback } from 'react'
import {
  clearPrefetchCache,
  isEngineReady,
  prefetchSentence,
  preloadEngine,
  reloadEngine,
  startTtsStream,
  stopTtsStream,
} from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'
import type { TtsEngineType } from '@/lib/types'

export function useTtsWorker() {
  const loadEngine = useCallback((engineType: TtsEngineType) => {
    if (isEngineReady(engineType)) return
    preloadEngine(engineType)
  }, [])

  const switchEngine = useCallback((engineType: TtsEngineType) => {
    reloadEngine(engineType)
  }, [])

  const stopStream = useCallback(() => {
    stopTtsStream()
  }, [])

  const startStream = useCallback(
    async (
      chunks: string[],
      startIndex: number,
      onChunk: (chunk: {
        text: string
        pcm: Float32Array
        sampleRate: number
        sentenceIndex: number
      }) => void | Promise<void>,
    ) => {
      const { voice, speed } = usePlayerStore.getState()
      await startTtsStream(chunks, startIndex, voice, speed, onChunk)
    },
    [],
  )

  const prefetch = useCallback((sentenceIndex: number, text: string) => {
    const { voice, speed } = usePlayerStore.getState()
    prefetchSentence(sentenceIndex, text, voice, speed)
  }, [])

  const invalidatePrefetch = useCallback(() => {
    clearPrefetchCache()
  }, [])

  return {
    loadEngine,
    switchEngine,
    startStream,
    stopStream,
    prefetch,
    invalidatePrefetch,
    isEngineReady,
  }
}
