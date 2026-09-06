import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Speech, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { savePreferences } from '@/lib/preferences'
import { formatBytes } from '@/lib/tts/kittenDownload'
import { COMPILE_STAGE_LABELS } from '@/lib/tts/kittenTypes'
import { abortKittenLoad, switchEngine } from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'
import { cn } from '@/lib/utils'

function useCompileElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!active) return

    const start = performance.now()
    const timer = setInterval(() => {
      setSeconds(Math.floor((performance.now() - start) / 1000))
    }, 1000)

    return () => {
      clearInterval(timer)
      setSeconds(0)
    }
  }, [active])

  return active ? seconds : 0
}

export function ModelDownloadBanner({ className }: { className?: string }) {
  const {
    isModelLoading,
    isModelReady,
    modelProgress,
    modelLoadedBytes,
    modelTotalBytes,
    modelStatus,
    modelLoadPhase,
    modelCompileStage,
    modelError,
  } = usePlayerStore()

  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const errorDismissed = Boolean(modelError && dismissedError === modelError)
  const isCompiling = modelLoadPhase === 'compiling'
  const compileSeconds = useCompileElapsed(isCompiling)

  const useBrowserVoice = () => {
    abortKittenLoad()
    savePreferences({ engine: 'browser' })
  }

  if (modelStatus === 'error' && modelError && !errorDismissed) {
    const engineStartFailed = modelLoadPhase === 'compiling' || modelProgress >= 50
    return (
      <div className={cn('rounded-2xl bg-destructive/8 px-4 py-3 sm:px-5', className)}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-destructive" aria-hidden />
            <p className="text-sm font-medium text-destructive">
              {engineStartFailed ? 'Voice engine failed to start' : 'Voice model download failed'}
            </p>
          </div>
          {isModelReady && (
            <Button
              size="sm"
              variant="ghost"
              className="size-8 shrink-0 p-0"
              aria-label="Dismiss"
              onClick={() => setDismissedError(modelError ?? '')}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">{modelError}</p>
        {isModelReady && (
          <p className="mb-3 text-xs text-muted-foreground">
            Browser voice is ready for playback.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void switchEngine('kitten')}>
            <RotateCcw className="size-3.5" />
            Retry
          </Button>
          <Button size="sm" variant="outline" onClick={useBrowserVoice}>
            <Speech className="size-3.5" />
            Use browser voice
          </Button>
        </div>
      </div>
    )
  }

  const pct = Math.min(100, Math.max(0, modelProgress))
  const isDownloading = modelLoadPhase === 'downloading'
  const hasByteCounts =
    isDownloading && modelTotalBytes > 0 && modelLoadedBytes > 0
  const showProgress =
    isModelLoading && (modelLoadPhase === 'downloading' || modelLoadPhase === 'compiling')

  const stageLabel =
    modelCompileStage && modelCompileStage in COMPILE_STAGE_LABELS
      ? COMPILE_STAGE_LABELS[modelCompileStage]
      : null

  let progressLabel = `Preparing voice… ${pct}%`
  if (isDownloading && hasByteCounts) {
    progressLabel = `Downloading voice model… ${pct}% (${formatBytes(modelLoadedBytes)} / ${formatBytes(modelTotalBytes)})`
  } else if (isCompiling) {
    const detail = stageLabel ?? 'Starting voice engine'
    progressLabel = `${detail} (${compileSeconds}s)`
  } else if (showProgress) {
    progressLabel = `Preparing neural voice… ${pct}%`
  }

  return (
    <div className={cn('space-y-2', className)}>
      {showProgress && (
        <div className="surface-panel px-4 py-3">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">{progressLabel}</p>
          </div>
          <Progress value={Math.max(pct, 4)} className="mt-2.5 h-1" aria-hidden />
          {isModelReady && (
            <p className="mt-2 text-xs text-muted-foreground">
              Browser voice is available while the neural model loads.
            </p>
          )}
          {isCompiling && compileSeconds >= 45 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Taking longer than usual… you can keep using browser voice.
            </p>
          )}
          {isCompiling && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={useBrowserVoice}>
                <Speech className="size-3.5" />
                Continue with browser voice
              </Button>
            </div>
          )}
        </div>
      )}

      {isModelReady && !showProgress && modelLoadPhase === 'ready' && (
        <p className="text-center text-xs text-muted-foreground">
          <CheckCircle2 className="mr-1 inline size-3.5 text-primary" aria-hidden />
          Voice ready
        </p>
      )}
    </div>
  )
}
