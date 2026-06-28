import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router'
import { DropZone } from '@/components/upload/DropZone'
import { ModelDownloadBanner } from '@/components/tts/ModelDownloadBanner'
import { DocumentRow } from '@/components/library/DocumentRow'
import { loadRecentDocumentsWithProgress, type DocumentWithProgress } from '@/lib/documents'
import { applyPreferencesToStore } from '@/lib/preferences'

export function HomePage() {
  const [docs, setDocs] = useState<DocumentWithProgress[]>([])

  const refreshDocs = useCallback(() => {
    void loadRecentDocumentsWithProgress(5).then(setDocs).catch((err) => {
      console.error('[Home] Failed to load recent documents:', err)
    })
  }, [])

  useEffect(() => {
    applyPreferencesToStore()
    refreshDocs()
  }, [refreshDocs])

  return (
    <div className="home-hero flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-8 pb-[max(5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-12">
        <div className="text-center sm:text-left">
          <p className="text-xs text-muted-foreground">
            Private · works offline
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Turn PDFs into audiobooks
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted-foreground sm:mx-0">
            Upload a document and listen with word-by-word highlighting.
          </p>
        </div>

        <section className="mt-8">
          <ModelDownloadBanner />
        </section>

        <section className="mt-6">
          <DropZone />
        </section>

        {docs.length > 0 ? (
          <section className="mt-10">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold text-foreground">Continue reading</h2>
              <Link
                to="/library"
                className="text-sm font-semibold text-foreground transition-smooth hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="surface-panel mt-3 divide-y divide-border overflow-hidden">
              {docs.map((doc) => (
                <DocumentRow key={doc.docId} doc={doc} onUpdated={refreshDocs} compact />
              ))}
            </div>
          </section>
        ) : (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            No documents yet. Upload a PDF above to get started.
          </p>
        )}
      </div>
    </div>
  )
}
