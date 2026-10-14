if (typeof globalThis.DOMMatrix === 'undefined') {
  ;(globalThis as unknown as Record<string, unknown>).DOMMatrix = class DOMMatrix {}
}

import { describe, expect, it } from 'bun:test'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { WordPosition } from '../types'

const { getTextItemBounds, splitItemIntoWords } = await import('./extract')
const { mergeSentenceHighlightRects } = await import('./lineRects')

describe('PDF text extraction and highlight coverage', () => {
  it('correctly scales text item bounds according to viewport scale', () => {
    // Simulated PDF text item: font size 16, width 200pt, located at (50, 400) in PDF user units
    const item = {
      str: 'The quick brown fox jumps over the lazy dog',
      transform: [16, 0, 0, 16, 50, 400],
      width: 200,
      height: 16,
    }

    // Mock viewport for 500x500 PDF page rendered at scale 1.5
    // Transform matrix for scale 1.5: [scale, 0, 0, -scale, 0, height*scale]
    const viewportScale15 = {
      scale: 1.5,
      width: 750,
      height: 750,
      transform: [1.5, 0, 0, -1.5, 0, 750],
    } as unknown as ReturnType<PDFPageProxy['getViewport']>

    const bounds15 = getTextItemBounds(item, viewportScale15)

    // Origin X: 50 * 1.5 = 75
    expect(bounds15.left).toBe(75)
    // Width must be scaled by 1.5: 200 * 1.5 = 300 (previously was unscaled 200)
    expect(bounds15.width).toBe(300)
    // Height is visual text glyph height (~0.90 * fontHeight): 24 * 0.90 = 21.6
    expect(bounds15.height).toBe(21.6)
    // Top is baseline - ascent: 150 - (24 * 0.75) = 150 - 18 = 132
    expect(bounds15.top).toBe(132)
  })

  it('toHighlightBounds produces compact highlight covering just the text', async () => {
    const { toHighlightBounds } = await import('./highlightBounds')
    const box = toHighlightBounds({ left: 75, top: 132, width: 300, height: 21.6 }, 'sentence')
    // Top has 2px padding: 132 - 2 = 130
    expect(box.top).toBe(130)
    // Height has 2px top and 2px bottom padding: 21.6 + 4 = 25.6
    expect(box.height).toBe(25.6)
  })

  it('splits multi-word item so words span the entire scaled item width', () => {
    const text = 'The quick brown fox'
    const left = 75
    const top = 126
    const width = 300 // Scaled width at 1.5
    const height = 24

    const words = splitItemIntoWords(text, left, top, width, height)

    expect(words.length).toBe(4)
    expect(words[0].text).toBe('The')
    expect(words[0].left).toBe(75)

    // The last word must reach near the right edge of the item (width 300, so around 75 + 300 = 375)
    const lastWord = words[words.length - 1]
    expect(lastWord.text).toBe('fox')
    const lastWordRight = lastWord.left + lastWord.width
    expect(lastWordRight).toBeGreaterThan(370)
    expect(lastWordRight).toBeLessThanOrEqual(375.1)
  })

  it('sentence highlight rect covers the full line width to the right edge', () => {
    // 5 words on a line across 400px
    const pageWords: WordPosition[] = [
      { text: 'This', pageNum: 1, left: 50, top: 100, width: 60, height: 20, globalIndex: 0, sentenceIndex: 0 },
      { text: 'is', pageNum: 1, left: 120, top: 100, width: 30, height: 20, globalIndex: 1, sentenceIndex: 0 },
      { text: 'a', pageNum: 1, left: 160, top: 100, width: 20, height: 20, globalIndex: 2, sentenceIndex: 0 },
      { text: 'full', pageNum: 1, left: 190, top: 100, width: 60, height: 20, globalIndex: 3, sentenceIndex: 0 },
      { text: 'sentence.', pageNum: 1, left: 260, top: 100, width: 140, height: 20, globalIndex: 4, sentenceIndex: 0 },
    ]

    const rects = mergeSentenceHighlightRects(pageWords, pageWords)
    expect(rects.length).toBe(1)
    expect(rects[0].left).toBe(50)
    // The right edge should cover all the way through the last word (260 + 140 = 400) + trailing extend
    expect(rects[0].left + rects[0].width).toBeGreaterThanOrEqual(400)
  })

  it('buildWordMap preserves all words after standalone punctuation tokens like em-dashes', async () => {
    const { buildWordMap } = await import('../pipeline/wordMap')
    const rawWords = [
      { text: 'Hello', pageNum: 1, left: 10, top: 20, width: 40, height: 14 },
      { text: '—', pageNum: 1, left: 55, top: 20, width: 15, height: 14 },
      { text: 'world', pageNum: 1, left: 75, top: 20, width: 45, height: 14 },
      { text: 'today.', pageNum: 1, left: 125, top: 20, width: 45, height: 14 },
      { text: 'Next', pageNum: 1, left: 180, top: 20, width: 35, height: 14 },
      { text: 'sentence.', pageNum: 1, left: 220, top: 20, width: 65, height: 14 },
    ]

    const { words, sentences } = buildWordMap(rawWords)
    expect(words.map((w) => w.text)).toEqual([
      'Hello',
      '—',
      'world',
      'today.',
      'Next',
      'sentence.',
    ])
    expect(sentences.length).toBe(2)
    expect(sentences[0].startWordIndex).toBe(0)
    expect(sentences[0].endWordIndex).toBe(3)
    expect(sentences[1].startWordIndex).toBe(4)
    expect(sentences[1].endWordIndex).toBe(5)
  })

  it('HighlightSync emits accurate word and sentenceIndex timings with seekToTime', async () => {
    const { HighlightSync } = await import('../audio/highlightSync')
    const sync = new HighlightSync()
    const events: Array<{ wordIndex: number; pageNum: number; sentenceIndex: number }> = []
    sync.onWord((wordIndex, pageNum, sentenceIndex) => {
      events.push({ wordIndex, pageNum, sentenceIndex })
    })

    const s0Words: WordPosition[] = [
      { text: 'Short', pageNum: 1, left: 10, top: 10, width: 30, height: 12, globalIndex: 0, sentenceIndex: 0 },
      { text: 'sentence.', pageNum: 1, left: 45, top: 10, width: 60, height: 12, globalIndex: 1, sentenceIndex: 0 },
    ]
    const s1Words: WordPosition[] = [
      { text: 'Second', pageNum: 2, left: 10, top: 10, width: 40, height: 12, globalIndex: 2, sentenceIndex: 1 },
      { text: 'line.', pageNum: 2, left: 55, top: 10, width: 30, height: 12, globalIndex: 3, sentenceIndex: 1 },
    ]

    sync.registerSentenceTiming(s0Words, 0, 1.0)
    sync.registerSentenceTiming(s1Words, 1.0, 1.0)

    sync.seekToTime(0.05)
    expect(events[events.length - 1]).toEqual({ wordIndex: 0, pageNum: 1, sentenceIndex: 0 })

    sync.seekToTime(0.85)
    expect(events[events.length - 1]).toEqual({ wordIndex: 1, pageNum: 1, sentenceIndex: 0 })

    sync.seekToTime(1.1)
    expect(events[events.length - 1]).toEqual({ wordIndex: 2, pageNum: 2, sentenceIndex: 1 })
  })
})
