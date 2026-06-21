import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Speech } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { savePreferences } from '@/lib/preferences'
import { formatBytes } from '@/lib/tts/kittenDownload'
import { prepareBrowserTts } from '@/lib/tts/browserSpeech'
import { switchEngine, unloadTtsEngine } from '@/lib/tts/ttsWorkerManager'
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
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void switchEngine('kitten')}>
            <RotateCcw className="size-3.5" />
            Retry
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              unloadTtsEngine()
              savePreferences({ engine: 'browser' })
              void prepareBrowserTts()
            }}
          >
            <Speech className="size-3.5" />
            Use browser voice
          </Button>
        </div>
      </div>
    )
  }

  const pct = Math.min(100, Math.max(0, modelProgress))
  const hasByteCounts = modelTotalBytes > 0 && modelLoadedBytes > 0
  const showProgress = isModelLoading && !isModelReady

  return (
    <div className={cn('space-y-2', className)}>
      {showProgress && (
        <div className="surface-panel px-4 py-3">
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
          <CheckCircle2 className="mr-1 inline size-3.5 text-primary" aria-hidden />
          Voice ready
        </p>
      )}
    </div>
  )
}
