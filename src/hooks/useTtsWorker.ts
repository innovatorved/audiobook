import { useCallback } from 'react'
import {
  isEngineReady,
  switchEngine as switchEngineImpl,
  startTtsStream,
  stopTtsStream,
  prefetchSynthTexts,
} from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'
import type { TtsEngineType } from '@/lib/types'

export function useTtsWorker() {
  const loadEngine = useCallback((engineType: TtsEngineType) => {
    void switchEngineImpl(engineType)
  }, [])

  const switchEngine = useCallback((engineType: TtsEngineType) => {
    void switchEngineImpl(engineType)
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
    loadEngine,
    switchEngine,
    startStream,
    stopStream,
    prefetchSynth,
    isEngineReady,
  }
}
