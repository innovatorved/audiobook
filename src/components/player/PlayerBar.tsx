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
    modelProgress,
    modelLoadedBytes,
    modelTotalBytes,
    currentSentenceIndex,
    totalSentences,
  } = usePlayerStore()

  const handlePlayPause = () => {
    // #region agent log
    fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'play-btn-v1',location:'PlayerBar.tsx:handlePlayPause',message:'play button clicked',data:{isPlaying,isModelReady,isModelLoading,totalSentences},timestamp:Date.now(),hypothesisId:'play-btn'})}).catch(()=>{});
    // #endregion
    onPlayPause()
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-5 pt-6 sm:px-6">
      <div
        className="w-full max-w-2xl rounded-2xl border border-border/60 bg-card shadow-lg"
      >
        {isModelLoading && !isModelReady && (
          <div className="border-b border-border/50 px-4 py-2.5">
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

        <div className="flex items-center gap-3 px-4 py-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
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
                className="size-11 shrink-0 rounded-full"
                onClick={handlePlayPause}
                disabled={!isModelReady || isModelLoading}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="size-[18px]" fill="currentColor" />
                ) : (
                  <Play className="ml-0.5 size-[18px]" fill="currentColor" />
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
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
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

          <span className="hidden shrink-0 tabular-nums text-xs text-muted-foreground sm:inline">
            {totalSentences > 0
              ? `${currentSentenceIndex + 1} / ${totalSentences}`
              : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}
