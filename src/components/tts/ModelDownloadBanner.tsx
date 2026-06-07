import { AlertCircle, CheckCircle2, Cpu, Loader2, RotateCcw, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { RecommendedBadge } from '@/components/player/RecommendedBadge'
import { ENGINE_OPTIONS } from '@/lib/tts/engineOptions'
import { formatBytes } from '@/lib/tts/kittenDownload'
import { getLoadingEngine, switchEngine } from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'
import type { TtsEngineType } from '@/lib/types'
import { cn } from '@/lib/utils'

const ENGINE_CARD_META: Record<
  TtsEngineType,
  { size: string; hint: string; icon: typeof Zap }
> = {
  kitten: { size: '~43 MB', hint: 'Best quality — Bella, Jasper, Luna', icon: Zap },
  piper: { size: '~75 MB', hint: 'CPU-friendly — lessac, amy, ryan', icon: Cpu },
}

export function ModelDownloadBanner({ className }: { className?: string }) {
  const {
    isModelLoading,
    isModelReady,
    modelProgress,
    modelLoadedBytes,
    modelTotalBytes,
    modelStatus,
    modelError,
    engine,
  } = usePlayerStore()

  const loadingEngine = getLoadingEngine()

  const handleSelectEngine = (next: TtsEngineType) => {
    void switchEngine(next)
  }

  if (modelStatus === 'error' && modelError) {
    return (
      <div className={cn('rounded-2xl bg-destructive/8 px-4 py-3 sm:px-5', className)}>
        <div className="mb-1.5 flex items-center gap-2">
          <AlertCircle className="size-4 text-destructive" aria-hidden />
          <p className="text-sm font-medium text-destructive">Voice model download failed</p>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">{modelError}</p>
        <Button size="sm" variant="outline" onClick={() => void switchEngine(engine)}>
          <RotateCcw className="size-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  const activeMeta = ENGINE_OPTIONS.find((o) => o.id === (loadingEngine ?? engine))
  const pct = Math.min(100, Math.max(0, modelProgress))
  const hasByteCounts = modelTotalBytes > 0 && modelLoadedBytes > 0
  const showProgress = isModelLoading && !isModelReady

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid gap-2 sm:grid-cols-2">
        {ENGINE_OPTIONS.map((opt) => {
          const cardMeta = ENGINE_CARD_META[opt.id]
          const Icon = cardMeta.icon
          const isSelected = engine === opt.id
          const isLoading = loadingEngine === opt.id || (isModelLoading && isSelected)
          const isReady = isSelected && isModelReady && !isModelLoading

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelectEngine(opt.id)}
              className={cn(
                'min-h-[4.5rem] rounded-xl border px-3 py-3 text-left transition-smooth sm:px-4',
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border bg-card hover:border-primary/35',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg',
                      isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {opt.label}
                      {opt.recommended && <RecommendedBadge />}
                    </p>
                    <p className="text-xs text-muted-foreground">{cardMeta.size}</p>
                  </div>
                </div>
                {isLoading && <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
                {isReady && <CheckCircle2 className="size-4 shrink-0 text-success" />}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{cardMeta.hint}</p>
              {isLoading && (
                <Progress value={Math.max(pct, 4)} className="mt-2.5 h-1" aria-hidden />
              )}
            </button>
          )
        })}
      </div>

      {showProgress && activeMeta && (
        <p className="text-center text-xs text-muted-foreground sm:text-sm">
          {pct > 0 && pct < 95 && hasByteCounts
            ? `Loading ${activeMeta.label}… ${pct}% (${formatBytes(modelLoadedBytes)} / ${formatBytes(modelTotalBytes)})`
            : `Loading ${activeMeta.label}… ${pct}%`}
        </p>
      )}

      {isModelReady && !isModelLoading && (
        <p className="text-center text-xs text-muted-foreground">
          <CheckCircle2 className="mr-1 inline size-3.5 text-success" />
          {activeMeta?.label ?? 'Voice'} ready — upload a PDF to start listening
        </p>
      )}
    </div>
  )
}
