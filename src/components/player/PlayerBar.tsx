import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Scrubber } from '@/components/player/Scrubber'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { formatBytes } from '@/lib/tts/kittenDownload'
import { isPlaybackReady } from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'
import { cn } from '@/lib/utils'

interface PlayerBarProps {
  onPlayPause: () => void
  onSkipBack: () => void
  onSkipForward: () => void
  onScrub: (index: number) => void
}

export function PlayerBar({
  onPlayPause,
  onSkipBack,
  onSkipForward,
  onScrub,
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
  } = usePlayerStore()
  const canPlay = isPlaybackReady()
  const showVoiceProgress =
    isModelLoading &&
    (modelLoadPhase === 'downloading' || modelLoadPhase === 'compiling')

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
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

        <div className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-3.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onSkipBack}
            aria-label="Previous sentence"
          >
            <SkipBack className="size-4" />
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                className={cn(
                  'shrink-0 text-foreground hover:text-foreground',
                  !canPlay && 'opacity-50',
                )}
                onClick={onPlayPause}
                disabled={!canPlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="size-5" fill="currentColor" />
                ) : (
                  <Play className="ml-0.5 size-5" fill="currentColor" />
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
            className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onSkipForward}
            aria-label="Next sentence"
          >
            <SkipForward className="size-4" />
          </Button>

          <div className="min-w-0 flex-1 px-1">
            <Scrubber
              value={currentSentenceIndex}
              max={Math.max(0, totalSentences - 1)}
              onChange={onScrub}
            />
          </div>

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
