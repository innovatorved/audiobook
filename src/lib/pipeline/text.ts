import { split } from 'sentence-splitter'
import type { SentenceSplitterTxtNode } from 'sentence-splitter'

const MAX_CHUNK_CHARS = 400

function isSentenceNode(node: SentenceSplitterTxtNode): boolean {
  return node.type === 'Sentence'
}

export function extractSentences(fullText: string): string[] {
  const nodes = split(fullText) as SentenceSplitterTxtNode[]
  return nodes
    .filter(isSentenceNode)
    .map((node) => node.raw.trim())
    .filter(Boolean)
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
