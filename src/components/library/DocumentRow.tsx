import { useState } from 'react'
import { Link } from 'react-router'
import { FileText, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import {
  DeleteDocumentDialog,
  RenameDocumentDialog,
} from '@/components/library/DocumentDialogs'
import { deleteDocument, renameDocument } from '@/lib/db/index'
import type { DocumentWithProgress } from '@/lib/documents'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

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

interface DocumentRowProps {
  doc: DocumentWithProgress
  onUpdated: () => void
  compact?: boolean
}

export function DocumentRow({ doc, onUpdated, compact = false }: DocumentRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const hasProgress = doc.progressPct > 0

  return (
    <>
      <div
        className={cn(
          'group flex min-h-[4.5rem] w-full items-center gap-3 px-4 py-4 transition-smooth hover:bg-muted sm:gap-4 sm:px-5',
          !compact && 'sm:py-5',
        )}
      >
        <Link
          to={`/read/${doc.docId}`}
          className="flex min-w-0 flex-1 items-center gap-3 transition-smooth hover:opacity-90 sm:gap-4"
        >
          <div className="icon-tile size-10 shrink-0">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium text-foreground">{doc.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatPageCount(doc.totalPages)} · {formatRelativeTime(doc.lastOpened)}
              {hasProgress && (
                <span className="tabular-nums"> · {doc.progressPct}%</span>
              )}
            </p>
            {hasProgress && (
              <Progress value={doc.progressPct} className="mt-2.5 h-1" />
            )}
          </div>
        </Link>

        {!compact && (
          <div className="relative shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Document actions"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal className="size-4" />
            </Button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-50 mt-1 w-40 rounded-lg border border-border bg-popover py-1 shadow-md">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                    onClick={() => {
                      setMenuOpen(false)
                      setRenameOpen(true)
                    }}
                  >
                    <Pencil className="size-3.5" />
                    Rename
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setMenuOpen(false)
                      setDeleteOpen(true)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <RenameDocumentDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        currentName={doc.name}
        onConfirm={async (name) => {
          await renameDocument(doc.docId, name)
          toast.success('Document renamed')
          onUpdated()
        }}
      />

      <DeleteDocumentDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        documentName={doc.name}
        onConfirm={async () => {
          await deleteDocument(doc.docId)
          toast.success('Document deleted')
          onUpdated()
        }}
      />
    </>
  )
}
