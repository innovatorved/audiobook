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
import { isEngineReady } from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'

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
    isModelReady,
    isModelLoading,
    engine,
    modelProgress,
    modelLoadedBytes,
    modelTotalBytes,
    currentSentenceIndex,
    totalSentences,
    activePageNum,
  } = usePlayerStore()

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      <div
        role="region"
        aria-label="Audio player"
        className="pointer-events-auto w-full max-w-xl rounded-xl border border-border bg-card shadow-md"
      >
        {isModelLoading && !isModelReady && (
          <div className="border-b border-border px-4 py-2">
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

        <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={onSkipBack}
            aria-label="Previous sentence"
          >
            <SkipBack className="size-4" />
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="icon"
                className="size-10 shrink-0 rounded-full"
                onClick={onPlayPause}
                disabled={!isModelReady || isModelLoading || !isEngineReady()}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="size-4" fill="currentColor" />
                ) : (
                  <Play className="ml-0.5 size-4" fill="currentColor" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {!isModelReady
                ? 'Wait for voice model to load'
                : isPlaying
                  ? 'Pause (Space)'
                  : 'Play (Space)'}
            </TooltipContent>
          </Tooltip>

          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
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
