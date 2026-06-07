import { useCallback } from 'react'
import {
  isEngineReady,
  switchEngine,
  startTtsStream,
  stopTtsStream,
  prefetchSynthTexts,
} from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'

export function useTtsWorker() {
  const ensureEngine = useCallback(() => {
    void switchEngine('kitten')
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

  const prefetchSynth = useCallback((texts: string[]) => {
    prefetchSynthTexts(texts)
  }, [])

  return {
    ensureEngine,
    startStream,
    stopStream,
    prefetchSynth,
    isEngineReady,
  }
}
