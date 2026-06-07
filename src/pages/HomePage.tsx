import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { FileText } from 'lucide-react'
import { DropZone } from '@/components/upload/DropZone'
import { ModelDownloadBanner } from '@/components/tts/ModelDownloadBanner'
import { Progress } from '@/components/ui/progress'
import { applyPreferencesToStore } from '@/lib/preferences'
import { switchEngine } from '@/lib/tts/ttsWorkerManager'
import { getMetadata, getRecentDocuments, getProgress, type DocumentRecord } from '@/lib/db/index'

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

function formatPageCount(totalPages?: number): string {
  if (!totalPages) return 'PDF'
  return `${totalPages} ${totalPages === 1 ? 'page' : 'pages'}`
}

function DocCard({ doc }: { doc: DocumentRecord & { progressPct?: number; totalPages?: number } }) {
  const hasProgress = doc.progressPct !== undefined && doc.progressPct > 0

  return (
    <Link
      to={`/read/${doc.docId}`}
      className="flex min-h-[4.5rem] flex-col rounded-xl border border-border bg-card p-4 transition-smooth active:scale-[0.99] hover:border-primary/40"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-foreground">{doc.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatPageCount(doc.totalPages)} · {formatRelativeTime(doc.createdAt)}
            {hasProgress && (
              <span className="tabular-nums"> · {doc.progressPct}%</span>
            )}
          </p>
          {hasProgress && (
            <Progress value={doc.progressPct} className="mt-2.5 h-1" />
          )}
        </div>
      </div>
    </Link>
  )
}

export function HomePage() {
  const [docs, setDocs] = useState<Array<DocumentRecord & { progressPct?: number; totalPages?: number }>>([])

  useEffect(() => {
    applyPreferencesToStore()
    void switchEngine('kitten')
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const recent = await getRecentDocuments()
        const withProgress = await Promise.all(
          recent.map(async (doc) => {
            const [progress, metadata] = await Promise.all([
              getProgress(doc.docId),
              getMetadata(doc.docId),
            ])
            return {
              ...doc,
              progressPct: progress ? Math.min(100, progress.sentenceIndex * 2) : 0,
              totalPages: metadata?.totalPages,
            }
          }),
        )
        setDocs(withProgress)
      } catch (err) {
        console.error('[Home] Failed to load recent documents:', err)
      }
    })()
  }, [])

  return (
    <div className="home-hero flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-12">
        <div className="text-center sm:text-left">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Private · Offline-ready</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Turn PDFs into audiobooks
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground sm:mx-0 sm:text-base">
            Upload a document and listen with word-by-word highlighting.
          </p>
        </div>

        <section className="mt-6">
          <ModelDownloadBanner />
        </section>

        <section className="mt-5">
          <DropZone />
        </section>

        {docs.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-sm font-medium text-muted-foreground">Continue reading</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {docs.map((doc) => (
                <DocCard key={doc.docId} doc={doc} />
              ))}
            </div>
          </section>
        ) : (
          <p className="mt-8 rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
            No documents yet — upload a PDF above to get started.
          </p>
        )}
      </div>
    </div>
  )
}
