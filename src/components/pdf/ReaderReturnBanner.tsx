import { AlertCircle, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ReaderReturnBannerProps {
  visiblePage: number
  playbackPage: number
  reason: 'empty' | 'away'
  onReturn: () => void
}

export function ReaderReturnBanner({
  visiblePage,
  playbackPage,
  reason,
  onReturn,
}: ReaderReturnBannerProps) {
  const label =
    reason === 'empty'
      ? `No text on p.${visiblePage}`
      : `Away · playback on p.${playbackPage}`

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[55] flex justify-center px-3 sm:px-6"
      style={{ bottom: 'calc(5.25rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="pointer-events-auto relative w-full max-w-xl">
        <div
          role="alert"
          className="absolute right-0 bottom-0 flex max-w-[min(100%,18rem)] items-center gap-2 rounded-full border border-destructive/25 bg-card/95 py-1.5 pr-1.5 pl-3 shadow-md backdrop-blur-md"
        >
          <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden />
          <p className="min-w-0 truncate text-xs font-medium text-foreground">{label}</p>
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 gap-1 rounded-full px-2.5 text-xs"
            onClick={onReturn}
          >
            <ArrowUp className="size-3" aria-hidden />
            Return
          </Button>
        </div>
      </div>
    </div>
  )
}
