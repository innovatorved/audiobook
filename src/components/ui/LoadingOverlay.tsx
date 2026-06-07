import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LoadingOverlayProps {
  message?: string
  className?: string
}

export function LoadingOverlay({ message = 'Loading…', className }: LoadingOverlayProps) {
  return (
    <div
      className={cn(
        'absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/75 backdrop-blur-[2px]',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-card shadow-md ring-1 ring-border">
        <Loader2 className="size-5 animate-spin text-foreground" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
    </div>
  )
}
