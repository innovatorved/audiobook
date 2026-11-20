import { useCallback } from 'react'
import {
  isEngineReady,
  switchEngine,
  startTtsStream,
  stopTtsStream,
  interruptPlaybackOnly,
  prefetchSynthTexts,
  warmSynthText,
  peekSynthCache,
  isSynthWarming,
  setBackgroundPrefetchEnabled,
} from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'

export function useTtsWorker() {
  const ensureEngine = useCallback(() => {
    if (usePlayerStore.getState().engine === 'kitten') {
      void switchEngine('kitten')
    }
  }, [])

  const stopStream = useCallback(() => {
    stopTtsStream()
  }, [])

  const interruptPlayback = useCallback(() => {
    interruptPlaybackOnly()
  }, [])

  const warmSynth = useCallback((text: string) => {
    warmSynthText(text)
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
      const { voice } = usePlayerStore.getState()
      // Synthesize at 1.0x so audioScheduler controls playbackRate cleanly without double-scaling speed
      await startTtsStream(chunks, startIndex, voice, 1.0, onChunk)
    },
    [],
  )

  const prefetchSynth = useCallback((texts: string[]) => {
    prefetchSynthTexts(texts)
  }, [])

  const enableContinuousPrefetch = useCallback((enabled: boolean) => {
    setBackgroundPrefetchEnabled(enabled)
  }, [])

  return {
    ensureEngine,
    startStream,
    stopStream,
    interruptPlayback,
    prefetchSynth,
    warmSynth,
    peekCache: peekSynthCache,
    isWarming: isSynthWarming,
    enableContinuousPrefetch,
    isEngineReady,
  }
}
