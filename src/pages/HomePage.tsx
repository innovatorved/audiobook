import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, FileText } from 'lucide-react'
import { DropZone } from '@/components/upload/DropZone'
import { ModelDownloadBanner } from '@/components/tts/ModelDownloadBanner'
import { Progress } from '@/components/ui/progress'
import { preloadEngine } from '@/lib/tts/ttsWorkerManager'
import { getRecentDocuments, getProgress, type DocumentRecord } from '@/lib/db/index'

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

function DocRow({ doc }: { doc: DocumentRecord & { progressPct?: number } }) {
  const hasProgress = doc.progressPct !== undefined && doc.progressPct > 0

  return (
    <Link
      to={`/read/${doc.docId}`}
      className="group flex items-center gap-4 rounded-xl px-3 py-3 transition-smooth hover:bg-accent"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-smooth group-hover:bg-primary/10 group-hover:text-primary">
        <FileText className="size-[18px]" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{doc.name}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {formatRelativeTime(doc.createdAt)}
          {hasProgress && (
            <span className="tabular-nums"> · {doc.progressPct}%</span>
          )}
        </p>
        {hasProgress && (
          <Progress value={doc.progressPct} className="mt-2.5 h-0.5" />
        )}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-smooth group-hover:text-muted-foreground" />
    </Link>
  )
}

export function HomePage() {
  const [docs, setDocs] = useState<Array<DocumentRecord & { progressPct?: number }>>([])

  useEffect(() => {
    void preloadEngine('kitten')
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const recent = await getRecentDocuments()
        const withProgress = await Promise.all(
          recent.map(async (doc) => {
            const progress = await getProgress(doc.docId)
            return {
              ...doc,
              progressPct: progress ? Math.min(100, progress.sentenceIndex * 2) : 0,
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
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-xl px-5 py-10 sm:px-8 sm:py-12">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
            Library
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Upload a PDF and listen with synced highlighting. Everything stays on your device.
          </p>
        </header>

        <ModelDownloadBanner className="mb-6" />

        <DropZone />

        <section className="mt-12">
          <div className="mb-2 flex items-baseline justify-between px-3">
            <h2 className="text-sm font-medium text-muted-foreground">Recent</h2>
            {docs.length > 0 && (
              <span className="text-sm text-muted-foreground">{docs.length}</span>
            )}
          </div>

          {docs.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No documents yet. Add a PDF to get started.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {docs.map((doc) => (
                <DocRow key={doc.docId} doc={doc} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
