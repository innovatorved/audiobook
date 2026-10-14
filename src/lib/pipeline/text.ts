import { split } from 'sentence-splitter'
import type { SentenceSplitterTxtNode } from 'sentence-splitter'

const MAX_CHUNK_CHARS = 240
const MAX_SENTENCE_CHARS = 240
const MIN_SPLIT_CHARS = 100

function isSentenceNode(node: SentenceSplitterTxtNode): boolean {
  return node.type === 'Sentence'
}

/**
 * Splits a long sentence into smaller exact substrings of `raw` so `mapPageWords`
 * can still locate every segment via `fullText.indexOf(seg, searchFrom)` and
 * synthesis / sentence highlighting stay responsive even on period-less PDF blocks.
 */
function splitLongSentenceSubstring(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.length <= MAX_SENTENCE_CHARS) return [trimmed]

  const out: string[] = []
  let rest = trimmed

  while (rest.length > MAX_SENTENCE_CHARS) {
    const window = rest.slice(0, MAX_SENTENCE_CHARS)
    let splitIdx = -1

    // Prefer splitting after a clause boundary (; : — – ,) in the second half of the window
    for (let i = window.length - 1; i >= MIN_SPLIT_CHARS; i--) {
      const ch = window[i]
      if ((ch === ';' || ch === ':' || ch === '—' || ch === '–' || ch === ',') && window[i + 1] === ' ') {
        splitIdx = i + 1
        break
      }
    }

    // Fallback to last whitespace in window
    if (splitIdx === -1) {
      splitIdx = window.lastIndexOf(' ')
    }

    // Fallback to hard split if a single token exceeds MAX_SENTENCE_CHARS
    if (splitIdx <= 0) {
      splitIdx = MAX_SENTENCE_CHARS
    }

    const head = rest.slice(0, splitIdx).trim()
    if (head) out.push(head)
    rest = rest.slice(splitIdx).trim()
  }

  if (rest) out.push(rest)
  return out
}

export function extractSentences(fullText: string): string[] {
  const nodes = split(fullText) as SentenceSplitterTxtNode[]
  const results: string[] = []
  for (const node of nodes) {
    if (!isSentenceNode(node)) continue
    const subSentences = splitLongSentenceSubstring(node.raw)
    for (const s of subSentences) {
      if (s) results.push(s)
    }
  }
  return results
}

export function chunkSentences(sentences: string[]): string[] {
  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim())
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}

export function buildFullText(words: Array<{ text: string }>): string {
  return words.map((w) => w.text).join(' ')
}
