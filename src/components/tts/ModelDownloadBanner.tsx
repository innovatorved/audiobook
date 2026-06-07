import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/lib/tts/kittenDownload'
import { preloadEngine } from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'
import { cn } from '@/lib/utils'

const ENGINE_SIZE_LABEL: Record<string, string> = {
  kitten: '~43 MB',
  kokoro: '~82 MB',
  piper: '~15 MB',
}

export function ModelDownloadBanner({ className }: { className?: string }) {
  const {
    isModelLoading,
    isModelReady,
    modelProgress,
    modelLoadedBytes,
    modelTotalBytes,
    modelStatus,
    modelFromCache,
    modelError,
    engine,
  } = usePlayerStore()

  const [readyDismissed, setReadyDismissed] = useState(false)

  useEffect(() => {
    if (isModelReady && !modelFromCache) {
      const timer = window.setTimeout(() => setReadyDismissed(true), 4000)
      return () => window.clearTimeout(timer)
    }
  }, [isModelReady, modelFromCache])

  if (modelStatus === 'error' && modelError) {
    return (
      <div
        className={cn(
          'rounded-xl bg-destructive/8 px-4 py-3',
          className,
        )}
      >
        <div className="mb-1.5 flex items-center gap-2">
          <AlertCircle className="size-4 text-destructive" aria-hidden />
          <p className="text-sm font-medium text-destructive">Voice model download failed</p>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">{modelError}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void preloadEngine(engine)}
        >
          <RotateCcw className="size-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  if (modelFromCache && isModelReady) return null
  if (readyDismissed && isModelReady) return null
  if (!isModelLoading && !isModelReady) return null

  const sizeLabel = ENGINE_SIZE_LABEL[engine] ?? '~43 MB'
  const pct = Math.min(100, Math.max(0, modelProgress))
  const hasByteCounts = modelTotalBytes > 0 && modelLoadedBytes > 0

  let headline = `Downloading voice model (${sizeLabel})`
  let detail = `Downloading model… ${pct}%`

  if (modelStatus === 'cached') {
    headline = 'Loading cached voice model'
    detail = 'Model found in browser cache — starting quickly'
  } else if (isModelReady || modelStatus === 'ready') {
    headline = 'Voice model ready'
    detail = 'You can upload PDFs and listen with text-to-speech'
  } else if (hasByteCounts) {
    detail = `Downloading model… ${pct}% (${formatBytes(modelLoadedBytes)} / ${formatBytes(modelTotalBytes)})`
  } else if (pct === 0) {
    detail = 'Connecting to Hugging Face…'
  }

  return (
    <div
      className={cn(
        'rounded-xl bg-muted/70 px-4 py-3 transition-smooth',
        isModelReady && 'bg-success-muted',
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        {isModelReady ? (
          <CheckCircle2 className="size-4 text-success" aria-hidden />
        ) : (
          <Download className="size-4 text-muted-foreground" aria-hidden />
        )}
        <p className="text-sm font-medium">{headline}</p>
        {!isModelReady && (
          <span className="ml-auto text-sm tabular-nums text-muted-foreground">
            {pct}%
          </span>
        )}
      </div>

      <p className="mb-2.5 text-sm text-muted-foreground">{detail}</p>

      {!isModelReady && (
        <Progress value={Math.max(pct, 2)} className="h-1" aria-label="Voice model download progress" />
      )}
    </div>
  )
}
