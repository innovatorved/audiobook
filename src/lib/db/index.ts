import Dexie, { type Table } from 'dexie'
import type { TtsEngineType } from '@/lib/types'

export interface DocumentRecord {
  docId: string
  name: string
  pdfBlob: Blob
  createdAt: number
}

export interface ProgressRecord {
  docId: string
  pageNum: number
  wordIndex: number
  sentenceIndex: number
  timestamp: number
}

export interface MetadataRecord {
  docId: string
  isScanned: boolean
  totalPages: number
  voice: string
  speed: number
  engine: TtsEngineType
}

class AudiobookDatabase extends Dexie {
  documents!: Table<DocumentRecord, string>
  progress!: Table<ProgressRecord, string>
  metadata!: Table<MetadataRecord, string>

  constructor() {
    super('audiobook')
    this.version(1).stores({
      documents: 'docId',
      progress: 'docId',
      metadata: 'docId',
    })
    this.version(2).stores({
      documents: 'docId, createdAt',
      progress: 'docId',
      metadata: 'docId',
    })
  }
}

export const db = new AudiobookDatabase()

export async function hashPdfBuffer(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function saveDocument(
  name: string,
  pdfBlob: Blob,
  buffer: ArrayBuffer,
): Promise<string> {
  const docId = await hashPdfBuffer(buffer)
  const existing = await db.documents.get(docId)
  if (!existing) {
    await db.documents.put({
      docId,
      name,
      pdfBlob,
      createdAt: Date.now(),
    })
  }
  return docId
}

export async function getRecentDocuments(limit = 20): Promise<DocumentRecord[]> {
  return db.documents.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function getDocument(docId: string): Promise<DocumentRecord | undefined> {
  return db.documents.get(docId)
}

export async function saveProgress(record: ProgressRecord): Promise<void> {
  await db.progress.put(record)
}

export async function getProgress(docId: string): Promise<ProgressRecord | undefined> {
  return db.progress.get(docId)
}

export async function saveMetadata(record: MetadataRecord): Promise<void> {
  await db.metadata.put(record)
}

export async function getMetadata(docId: string): Promise<MetadataRecord | undefined> {
  return db.metadata.get(docId)
}
