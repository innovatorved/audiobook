import { create } from 'zustand'
import type { TtsEngineType, VoiceInfo } from '@/lib/types'
import { clampPlaybackSpeed } from '@/lib/audio/speed'

export type ModelLoadStatus = 'idle' | 'downloading' | 'cached' | 'ready' | 'error'
export type ModelLoadPhase = 'idle' | 'downloading' | 'compiling' | 'ready' | 'error'

interface PlayerState {
  isPlaying: boolean
  isModelLoading: boolean
  isModelReady: boolean
  engineReady: boolean
  modelProgress: number
  modelLoadedBytes: number
  modelTotalBytes: number
  modelStatus: ModelLoadStatus
  modelLoadPhase: ModelLoadPhase
  modelFromCache: boolean
  modelError: string | null
  speed: number
  volume: number
  voice: string
  engine: TtsEngineType
  voices: VoiceInfo[]
  activeWordIndex: number
  activePageNum: number
  currentSentenceIndex: number
  totalSentences: number
  setPlaying: (isPlaying: boolean) => void
  setModelLoading: (
    loading: boolean,
    progress?: number,
    details?: {
      loadedBytes?: number
      totalBytes?: number
      status?: ModelLoadStatus
      phase?: ModelLoadPhase
    },
  ) => void
  setModelLoadPhase: (phase: ModelLoadPhase) => void
  setModelReady: (ready: boolean) => void
  setEngineReady: (ready: boolean) => void
  setModelError: (message: string | null) => void
  setSpeed: (speed: number) => void
  setVolume: (volume: number) => void
  setVoice: (voice: string) => void
  setEngine: (engine: TtsEngineType) => void
  setVoices: (voices: VoiceInfo[]) => void
  setActiveWord: (wordIndex: number, pageNum: number) => void
  setSentenceIndex: (index: number) => void
  setTotalSentences: (total: number) => void
  reset: () => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  isPlaying: false,
  isModelLoading: false,
  isModelReady: false,
  engineReady: false,
  modelProgress: 0,
  modelLoadedBytes: 0,
  modelTotalBytes: 0,
  modelStatus: 'idle',
  modelLoadPhase: 'idle',
  modelFromCache: false,
  modelError: null,
  speed: 1,
  volume: 1,
  voice: 'Bella',
  engine: 'kitten',
  voices: [],
  activeWordIndex: -1,
  activePageNum: 1,
  currentSentenceIndex: 0,
  totalSentences: 0,

  setPlaying: (isPlaying) => set({ isPlaying }),
  setModelLoading: (loading, progress = 0, details) =>
    set((state) => ({
      isModelLoading: loading,
      modelProgress: progress,
      ...(details?.loadedBytes !== undefined && { modelLoadedBytes: details.loadedBytes }),
      ...(details?.totalBytes !== undefined && { modelTotalBytes: details.totalBytes }),
      ...(details?.status !== undefined && { modelStatus: details.status }),
      ...(details?.phase !== undefined && { modelLoadPhase: details.phase }),
      ...(loading &&
        details?.phase === undefined &&
        state.modelLoadPhase === 'idle' && { modelLoadPhase: 'downloading' as const }),
    })),
  setModelLoadPhase: (phase) => set({ modelLoadPhase: phase }),
  setModelReady: (ready) =>
    set((state) => ({
      isModelReady: ready,
      isModelLoading: false,
      modelProgress: ready ? 100 : 0,
      modelStatus: ready ? 'ready' : 'idle',
      modelLoadPhase: ready ? 'ready' : 'idle',
      modelError: ready ? null : state.modelError,
      modelFromCache: ready ? state.modelFromCache : false,
    })),
  setEngineReady: (ready) => set({ engineReady: ready }),
  setModelError: (message) =>
    set((state) => ({
      isModelLoading: false,
      isModelReady: false,
      engineReady: false,
      modelStatus: 'error',
      modelLoadPhase: 'error',
      modelError: message,
      modelProgress: state.modelProgress,
    })),
  setSpeed: (speed) => set({ speed: clampPlaybackSpeed(speed) }),
  setVolume: (volume) => set({ volume }),
  setVoice: (voice) => set({ voice }),
  setEngine: (engine) => set({ engine }),
  setVoices: (voices) => set({ voices }),
  setActiveWord: (wordIndex, pageNum) =>
    set({ activeWordIndex: wordIndex, activePageNum: pageNum }),
  setSentenceIndex: (index) => set({ currentSentenceIndex: index }),
  setTotalSentences: (total) => set({ totalSentences: total }),
  reset: () =>
    set({
      isPlaying: false,
      activeWordIndex: -1,
      activePageNum: 1,
      currentSentenceIndex: 0,
    }),
}))
