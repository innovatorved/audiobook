import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Scrubber } from '@/components/player/Scrubber'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { clampPlaybackSpeed } from '@/lib/audio/speed'
import { formatBytes } from '@/lib/tts/kittenDownload'
import { isPlaybackReady } from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'
import { cn } from '@/lib/utils'

const QUICK_SPEEDS = [0.8, 1.0, 1.2, 1.5, 1.8, 2.0] as const

function nextQuickSpeed(current: number): number {
  const safe = clampPlaybackSpeed(current)
  const next = QUICK_SPEEDS.find((s) => s > safe + 0.05)
  return next ?? QUICK_SPEEDS[0]
}

interface PlayerBarProps {
  onPlayPause: () => void
  onSkipBack: () => void
  onSkipForward: () => void
  onScrub: (index: number) => void
  onSpeedChange?: (speed: number) => void
}

export function PlayerBar({
  onPlayPause,
  onSkipBack,
  onSkipForward,
  onScrub,
  onSpeedChange,
}: PlayerBarProps) {
  const {
    isPlaying,
    isModelLoading,
    modelProgress,
    modelLoadedBytes,
    modelTotalBytes,
    modelLoadPhase,
    currentSentenceIndex,
    totalSentences,
    activePageNum,
    speed,
  } = usePlayerStore(
    useShallow((s) => ({
      isPlaying: s.isPlaying,
      isModelLoading: s.isModelLoading,
      modelProgress: s.modelProgress,
      modelLoadedBytes: s.modelLoadedBytes,
      modelTotalBytes: s.modelTotalBytes,
      modelLoadPhase: s.modelLoadPhase,
      currentSentenceIndex: s.currentSentenceIndex,
      totalSentences: s.totalSentences,
      activePageNum: s.activePageNum,
      speed: s.speed,
    })),
  )
  const canPlay = isPlaybackReady()
  const showVoiceProgress =
    isModelLoading &&
    (modelLoadPhase === 'downloading' || modelLoadPhase === 'compiling')

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center pt-3"
      style={{
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
      }}
    >
      <div
        role="region"
        aria-label="Audio player"
        className="surface-float pointer-events-auto w-full max-w-2xl overflow-hidden"
      >
        {showVoiceProgress && (
          <div className="px-4 py-2">
            <ProgressBar
              value={modelProgress}
              label={
                modelTotalBytes > 0
                  ? `Loading voice… ${modelProgress}% (${formatBytes(modelLoadedBytes)} / ${formatBytes(modelTotalBytes)})`
                  : `Loading voice… ${modelProgress}%`
              }
            />
          </div>
        )}

        <div className="flex items-center gap-1.5 px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 text-muted-foreground hover:text-foreground active:scale-95 sm:size-9"
            onClick={onSkipBack}
            aria-label="Previous sentence"
          >
            <SkipBack className="size-4" aria-hidden />
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                className={cn(
                  'shrink-0 text-foreground hover:text-foreground active:scale-95',
                  !canPlay && 'opacity-50',
                )}
                onClick={onPlayPause}
                disabled={!canPlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="size-5" fill="currentColor" aria-hidden />
                ) : (
                  <Play className="ml-0.5 size-5" fill="currentColor" aria-hidden />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {!canPlay
                ? 'Wait for voice model to load'
                : isPlaying
                  ? 'Pause (Space)'
                  : 'Play (Space)'}
            </TooltipContent>
          </Tooltip>

          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 text-muted-foreground hover:text-foreground active:scale-95 sm:size-9"
            onClick={onSkipForward}
            aria-label="Next sentence"
          >
            <SkipForward className="size-4" aria-hidden />
          </Button>

          <div className="min-w-0 flex-1 px-1">
            <Scrubber
              value={currentSentenceIndex}
              max={Math.max(0, totalSentences - 1)}
              onChange={onScrub}
            />
          </div>

          {onSpeedChange && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 shrink-0 rounded-full px-2.5 text-xs font-semibold tabular-nums text-muted-foreground hover:text-foreground active:scale-95"
              onClick={() => onSpeedChange(nextQuickSpeed(speed))}
              aria-label={`Playback speed ${clampPlaybackSpeed(speed).toFixed(1)}x. Tap to change.`}
            >
              {clampPlaybackSpeed(speed).toFixed(1)}×
            </Button>
          )}

          {activePageNum > 0 && (
            <span className="shrink-0 tabular-nums text-[11px] font-medium text-muted-foreground sm:hidden">
              p.{activePageNum}
            </span>
          )}

          <span
            className="hidden shrink-0 tabular-nums text-xs text-muted-foreground sm:inline"
            aria-live="polite"
          >
            {totalSentences > 0
              ? `${currentSentenceIndex + 1} / ${totalSentences}`
              : '—'}
            {activePageNum > 0 && (
              <span className="ml-1.5">· p.{activePageNum}</span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
