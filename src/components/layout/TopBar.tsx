import { Link } from 'react-router'
import { ArrowLeft, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { PlayerSettings } from '@/components/player/PlayerSettings'
import type { TtsEngineType } from '@/lib/types'

interface TopBarProps {
  title: string
  pageIndicator?: string
  onEngineChange?: (engine: TtsEngineType) => void
  onVoiceChange?: (voice: string) => void
}

export function TopBar({ title, pageIndicator, onEngineChange, onVoiceChange }: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-background px-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon-sm" className="shrink-0" asChild>
          <Link to="/" aria-label="Back to library">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
          {pageIndicator && (
            <p className="truncate text-xs text-muted-foreground">{pageIndicator}</p>
          )}
        </div>
      </div>

      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Playback settings">
            <Settings className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-6 py-5 text-left">
            <SheetTitle>Playback settings</SheetTitle>
            <SheetDescription>Voice, speed, and volume for this document</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <PlayerSettings
              onEngineChange={onEngineChange}
              onVoiceChange={onVoiceChange}
            />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  )
}
