import { Link } from 'react-router'
import { ArrowLeft, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsSheet } from '@/components/layout/SettingsSheet'

interface TopBarProps {
  title: string
  pageIndicator?: string
  onVoiceChange?: (voice: string) => void
}

export function TopBar({ title, pageIndicator, onVoiceChange }: TopBarProps) {
  return (
    <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-3 pt-[env(safe-area-inset-top)] sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon" className="size-9 shrink-0" asChild>
          <Link to="/" aria-label="Back to library">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
          {pageIndicator && (
            <p className="truncate text-xs text-muted-foreground">{pageIndicator}</p>
          )}
        </div>
      </div>

      <SettingsSheet
        onVoiceChange={onVoiceChange}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label="Playback settings"
          >
            <Settings className="size-4" />
          </Button>
        }
      />
    </header>
  )
}
