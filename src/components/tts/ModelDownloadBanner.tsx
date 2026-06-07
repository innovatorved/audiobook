import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/lib/tts/kittenDownload'
import { switchEngine } from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'
import { cn } from '@/lib/utils'

export function ModelDownloadBanner({ className }: { className?: string }) {
  const {
    isModelLoading,
    isModelReady,
    modelProgress,
    modelLoadedBytes,
    modelTotalBytes,
    modelStatus,
    modelError,
  } = usePlayerStore()

  if (modelStatus === 'error' && modelError) {
    return (
      <div className={cn('rounded-2xl bg-destructive/8 px-4 py-3 sm:px-5', className)}>
        <div className="mb-1.5 flex items-center gap-2">
          <AlertCircle className="size-4 text-destructive" aria-hidden />
          <p className="text-sm font-medium text-destructive">Voice model download failed</p>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">{modelError}</p>
        <Button size="sm" variant="outline" onClick={() => void switchEngine('kitten')}>
          <RotateCcw className="size-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  const pct = Math.min(100, Math.max(0, modelProgress))
  const hasByteCounts = modelTotalBytes > 0 && modelLoadedBytes > 0
  const showProgress = isModelLoading && !isModelReady

  return (
    <div className={cn('space-y-2', className)}>
      {showProgress && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {pct > 0 && pct < 95 && hasByteCounts
                ? `Preparing voice… ${pct}% (${formatBytes(modelLoadedBytes)} / ${formatBytes(modelTotalBytes)})`
                : `Preparing voice… ${pct}%`}
            </p>
          </div>
          <Progress value={Math.max(pct, 4)} className="mt-2.5 h-1" aria-hidden />
        </div>
      )}

      {isModelReady && !isModelLoading && (
        <p className="text-center text-xs text-muted-foreground">
          <CheckCircle2 className="mr-1 inline size-3.5 text-success" />
          Voice ready — upload a PDF to start listening
        </p>
      )}
    </div>
  )
}
