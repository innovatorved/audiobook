import {
  getAllDocuments,
  getMetadata,
  getProgress,
  getRecentDocuments,
  type DocumentRecord,
} from '@/lib/db/index'
import { computeProgressPct } from '@/lib/documentProgress'

export type DocumentWithProgress = DocumentRecord & {
  progressPct: number
  totalPages?: number
  lastOpened: number
}

async function enrichDocuments(
  docs: DocumentRecord[],
): Promise<DocumentWithProgress[]> {
  return Promise.all(
    docs.map(async (doc) => {
      const [progress, metadata] = await Promise.all([
        getProgress(doc.docId),
        getMetadata(doc.docId),
      ])
      return {
        ...doc,
        progressPct: computeProgressPct(
          progress?.sentenceIndex ?? 0,
          metadata?.totalSentences,
        ),
        totalPages: metadata?.totalPages,
        lastOpened: progress?.timestamp ?? doc.createdAt,
      }
    }),
  )
}

export async function loadRecentDocumentsWithProgress(
  limit = 5,
): Promise<DocumentWithProgress[]> {
  const recent = await getRecentDocuments(limit)
  return enrichDocuments(recent)
}

export async function loadAllDocumentsWithProgress(): Promise<DocumentWithProgress[]> {
  const docs = await getAllDocuments()
  return enrichDocuments(docs)
}
