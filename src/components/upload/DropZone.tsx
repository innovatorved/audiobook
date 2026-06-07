import { useCallback, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { saveDocument } from '@/lib/db/index'
import { cn } from '@/lib/utils'

export function DropZone() {
  const navigate = useNavigate()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        toast.error('Please upload a PDF file')
        return
      }

      setIsUploading(true)
      try {
        const buffer = await file.arrayBuffer()
        const docId = await saveDocument(file.name, file, buffer)
        toast.success('PDF uploaded')
        navigate(`/read/${docId}`)
      } catch {
        toast.error('Failed to upload PDF')
      } finally {
        setIsUploading(false)
      }
    },
    [navigate],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      className={cn(
        'block cursor-pointer rounded-2xl border bg-card transition-smooth',
        isDragging
          ? 'border-primary/40 bg-primary/[0.03]'
          : 'border-border hover:border-primary/25 hover:bg-accent/40',
        isUploading && 'pointer-events-none opacity-70',
      )}
    >
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        disabled={isUploading}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />

      <div className="flex items-center gap-5 px-6 py-5 sm:px-7 sm:py-6">
        <div
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-xl transition-smooth',
            isDragging || isUploading
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {isUploading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <FileText className="size-5" strokeWidth={2} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-foreground">
            {isUploading
              ? 'Opening PDF…'
              : isDragging
                ? 'Drop to open'
                : 'Add a PDF to your library'}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isUploading
              ? 'Extracting text for playback'
              : 'Drag and drop, or click to choose a file'}
          </p>
        </div>

        <span
          className={cn(
            'hidden shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-smooth sm:inline-flex',
            isUploading
              ? 'bg-muted text-muted-foreground'
              : 'bg-primary text-primary-foreground',
          )}
        >
          {isUploading ? 'Loading' : 'Choose file'}
        </span>
      </div>
    </label>
  )
}
