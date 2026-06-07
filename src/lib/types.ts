export interface WordPosition {
  text: string
  pageNum: number
  left: number
  top: number
  width: number
  height: number
  globalIndex: number
  sentenceIndex: number
}

export interface SentenceInfo {
  text: string
  startWordIndex: number
  endWordIndex: number
  pageNum: number
}

export type TtsEngineType = 'kitten'

export interface VoiceInfo {
  id: string
  label: string
  recommended?: boolean
}

export type ProgressCallback = (progress: {
  loaded: number
  total: number
  status?: 'downloading' | 'cached' | 'ready' | 'error'
}) => void
