import { useCallback, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { saveDocument } from '@/lib/db/index'
import { cn } from '@/lib/utils'

interface DropZoneProps {
  className?: string
}

export function DropZone({ className }: DropZoneProps) {
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
        const docId = await saveDocument(file.name, buffer)
        toast.success('PDF uploaded')
        navigate(`/read/${docId}`)
      } catch (err) {
        console.error('[DropZone] PDF upload failed:', err)
        const description =
          err instanceof Error ? err.message : 'Could not save the PDF locally.'
        toast.error('Failed to upload PDF', { description })
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
        'surface-panel block cursor-pointer transition-smooth focus-within:ring-2 focus-within:ring-primary/50',
        isDragging && 'border-primary ring-1 ring-primary/30',
        isUploading && 'pointer-events-none opacity-70',
        className,
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

        <div className="flex min-h-[4.5rem] items-center gap-4 px-4 py-5 sm:px-5 sm:py-6">
        <div
          className={cn(
            'icon-tile size-11 shrink-0 border border-dashed border-border',
            isDragging && 'border-primary bg-primary/10 text-primary',
            isUploading && 'text-primary',
          )}
        >
          {isUploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileText className="size-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {isUploading
              ? 'Opening PDF…'
              : isDragging
                ? 'Drop to open'
                : 'Choose a PDF'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Drag and drop here, or click to browse
          </p>
        </div>
      </div>
    </label>
  )
}
