import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { DropZone } from '@/components/upload/DropZone'
import { DocumentRow } from '@/components/library/DocumentRow'
import { loadAllDocumentsWithProgress, type DocumentWithProgress } from '@/lib/documents'

export function LibraryPage() {
  const [docs, setDocs] = useState<DocumentWithProgress[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refreshDocs = useCallback(() => {
    void loadAllDocumentsWithProgress()
      .then(setDocs)
      .catch((err) => {
        console.error('[Library] Failed to load documents:', err)
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    refreshDocs()
  }, [refreshDocs])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-8 pb-[max(5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Library
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {docs.length === 0 && !isLoading
                ? 'Your uploaded PDFs appear here.'
                : `${docs.length} ${docs.length === 1 ? 'document' : 'documents'}`}
            </p>
          </div>
          <Link
            to="/"
            className="text-sm font-semibold text-foreground transition-smooth hover:underline"
          >
            Upload
          </Link>
        </div>

        {isLoading ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading library…</p>
        ) : docs.length === 0 ? (
          <div className="mt-8 space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload your first PDF to start listening.
            </p>
            <DropZone />
          </div>
        ) : (
          <div className="surface-panel mt-6 divide-y divide-border overflow-hidden">
            {docs.map((doc) => (
              <DocumentRow key={doc.docId} doc={doc} onUpdated={refreshDocs} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
