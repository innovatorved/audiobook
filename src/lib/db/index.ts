import Dexie, { type Table } from 'dexie'
import { digestSha256 } from '@/lib/hash/sha256'
import type { TtsEngineType } from '@/lib/types'

const DB_NAME = 'audiobook-reader'

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
  totalSentences?: number
  voice: string
  speed: number
  engine: TtsEngineType
}

export interface VoiceModelCacheRecord {
  manifestHash: string
  modelBuffer: ArrayBuffer
  voicesBuffer: ArrayBuffer
  config: Record<string, unknown>
  updatedAt: number
}

export interface OrtWasmCacheRecord {
  id: string
  wasmBuffer: ArrayBuffer
  updatedAt: number
}

class AudiobookDatabase extends Dexie {
  documents!: Table<DocumentRecord, string>
  progress!: Table<ProgressRecord, string>
  metadata!: Table<MetadataRecord, string>
  voiceModelCache!: Table<VoiceModelCacheRecord, string>
  ortWasmCache!: Table<OrtWasmCacheRecord, string>

  constructor() {
    super(DB_NAME)
    this.version(1).stores({
      documents: 'docId, createdAt',
      progress: 'docId',
      metadata: 'docId',
    })
    this.version(2).stores({
      documents: 'docId, createdAt',
      progress: 'docId',
      metadata: 'docId',
      voiceModelCache: 'manifestHash',
    })
    this.version(3).stores({
      documents: 'docId, createdAt',
      progress: 'docId',
      metadata: 'docId',
      voiceModelCache: 'manifestHash',
      ortWasmCache: 'id',
    })
  }
}

export const db = new AudiobookDatabase()

let dbReady: Promise<void> | null = null

function readLegacyStore<T>(storeName: string): Promise<T[]> {
  return new Promise((resolve) => {
    const request = indexedDB.open('audiobook')
    request.onsuccess = () => {
      const idb = request.result
      if (!idb.objectStoreNames.contains(storeName)) {
        idb.close()
        resolve([])
        return
      }
      const tx = idb.transaction(storeName, 'readonly')
      const getAll = tx.objectStore(storeName).getAll()
      getAll.onsuccess = () => {
        idb.close()
        resolve(getAll.result as T[])
      }
      getAll.onerror = () => {
        idb.close()
        resolve([])
      }
    }
    request.onerror = () => resolve([])
  })
}

async function migrateLegacyDatabase(): Promise<void> {
  const existing = await db.documents.count()
  if (existing > 0) return

  const [documents, progress, metadata] = await Promise.all([
    readLegacyStore<DocumentRecord>('documents'),
    readLegacyStore<ProgressRecord>('progress'),
    readLegacyStore<MetadataRecord>('metadata'),
  ])

  if (documents.length === 0) return

  await db.transaction('rw', db.documents, db.progress, db.metadata, async () => {
    for (const doc of documents) {
      await db.documents.put({
        ...doc,
        createdAt: doc.createdAt ?? Date.now(),
      })
    }
    for (const record of progress) {
      await db.progress.put(record)
    }
    for (const record of metadata) {
      await db.metadata.put(record)
    }
  })
}

export async function ensureDbOpen(): Promise<void> {
  if (!dbReady) {
    dbReady = (async () => {
      try {
        await db.open()
      } catch (err) {
        const dexieErr = err as Dexie.DexieError
        if (dexieErr.name === 'VersionError') {
          await db.delete()
          await db.open()
        } else {
          throw err
        }
      }
      await migrateLegacyDatabase()
    })()
  }
  await dbReady
}

export async function hashPdfBuffer(buffer: ArrayBuffer): Promise<string> {
  return digestSha256(buffer)
}

function formatStorageError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'QuotaExceededError') {
      return 'Storage is full. Remove old PDFs or free browser storage, then try again.'
    }
    if (err.name === 'SecurityError') {
      return 'Browser blocked storage. Disable private browsing or allow site data.'
    }
  }
  if (err instanceof Error && err.message) {
    return err.message
  }
  return 'Could not save the PDF locally.'
}

export async function saveDocument(name: string, buffer: ArrayBuffer): Promise<string> {
  await ensureDbOpen()

  if (buffer.byteLength === 0) {
    throw new Error('The selected file is empty.')
  }

  const docId = await hashPdfBuffer(buffer)
  const pdfBlob = new Blob([buffer], { type: 'application/pdf' })
  const existing = await db.documents.get(docId)

  try {
    await db.documents.put({
      docId,
      name,
      pdfBlob,
      createdAt: existing?.createdAt ?? Date.now(),
    })
  } catch (err) {
    throw new Error(formatStorageError(err), { cause: err })
  }

  return docId
}

export async function getRecentDocuments(limit = 20): Promise<DocumentRecord[]> {
  await ensureDbOpen()
  return db.documents.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function getAllDocuments(): Promise<DocumentRecord[]> {
  await ensureDbOpen()
  return db.documents.orderBy('createdAt').reverse().toArray()
}

export async function renameDocument(docId: string, name: string): Promise<void> {
  await ensureDbOpen()
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Document name cannot be empty.')
  }
  const existing = await db.documents.get(docId)
  if (!existing) {
    throw new Error('Document not found.')
  }
  await db.documents.put({ ...existing, name: trimmed })
}

export async function deleteDocument(docId: string): Promise<void> {
  await ensureDbOpen()
  await db.transaction('rw', db.documents, db.progress, db.metadata, async () => {
    await db.documents.delete(docId)
    await db.progress.delete(docId)
    await db.metadata.delete(docId)
  })
}

export async function getDocument(docId: string): Promise<DocumentRecord | undefined> {
  await ensureDbOpen()
  return db.documents.get(docId)
}

export async function saveProgress(record: ProgressRecord): Promise<void> {
  await ensureDbOpen()
  await db.progress.put(record)
}

export async function getProgress(docId: string): Promise<ProgressRecord | undefined> {
  await ensureDbOpen()
  return db.progress.get(docId)
}

export async function saveMetadata(record: MetadataRecord): Promise<void> {
  await ensureDbOpen()
  await db.metadata.put(record)
}

export async function getMetadata(docId: string): Promise<MetadataRecord | undefined> {
  await ensureDbOpen()
  return db.metadata.get(docId)
}
