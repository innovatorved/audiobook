import { create } from 'zustand'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { SentenceInfo, WordPosition } from '@/lib/types'

interface ReaderState {
  docId: string | null
  docName: string
  pdfDoc: PDFDocumentProxy | null
  totalPages: number
  isScanned: boolean
  words: WordPosition[]
  sentences: SentenceInfo[]
  sentenceTexts: string[]
  isExtracting: boolean
  extractionProgress: number
  ocrPagesReady: Set<number>
  setDocument: (docId: string, name: string, pdfDoc: PDFDocumentProxy) => void
  setScanned: (isScanned: boolean) => void
  setWords: (words: WordPosition[], sentences: SentenceInfo[], sentenceTexts: string[]) => void
  setExtracting: (isExtracting: boolean, progress?: number) => void
  addOcrPage: (pageNum: number) => void
  mergeOcrWords: (pageNum: number, pageWords: WordPosition[]) => void
  reset: () => void
}

const initialState = {
  docId: null,
  docName: '',
  pdfDoc: null,
  totalPages: 0,
  isScanned: false,
  words: [] as WordPosition[],
  sentences: [] as SentenceInfo[],
  sentenceTexts: [] as string[],
  isExtracting: false,
  extractionProgress: 0,
  ocrPagesReady: new Set<number>(),
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  ...initialState,

  setDocument: (docId, name, pdfDoc) =>
    set({
      docId,
      docName: name,
      pdfDoc,
      totalPages: pdfDoc.numPages,
    }),

  setScanned: (isScanned) => set({ isScanned }),

  setWords: (words, sentences, sentenceTexts) =>
    set({ words, sentences, sentenceTexts }),

  setExtracting: (isExtracting, progress = 0) =>
    set({ isExtracting, extractionProgress: progress }),

  addOcrPage: (pageNum) => {
    const ready = new Set(get().ocrPagesReady)
    ready.add(pageNum)
    set({ ocrPagesReady: ready })
  },

  mergeOcrWords: (pageNum, pageWords) => {
    const { words } = get()
    const filtered = words.filter((w) => w.pageNum !== pageNum)
    const merged = [...filtered, ...pageWords].sort((a, b) => {
      if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum
      if (a.top !== b.top) return a.top - b.top
      return a.left - b.left
    })
    const reindexed = merged.map((w, i) => ({ ...w, globalIndex: i }))
    set({ words: reindexed })
  },

  reset: () => set({ ...initialState, ocrPagesReady: new Set() }),
}))
