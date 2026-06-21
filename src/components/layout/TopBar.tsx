import { Link } from 'react-router'
import { ArrowLeft, Settings } from 'lucide-react'
import { SettingsSheet } from '@/components/layout/SettingsSheet'
import { cn } from '@/lib/utils'

interface TopBarProps {
  title: string
  pageIndicator?: string
  onVoiceChange?: (voice: string) => void
}

export function TopBar({ title, pageIndicator, onVoiceChange }: TopBarProps) {
  return (
    <header className="reader-chrome sticky top-0 z-40 shrink-0 pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 items-center gap-2 px-3 sm:gap-3 sm:px-5">
        <Link
          to="/library"
          aria-label="Back to library"
          className="icon-touch size-10"
        >
          <ArrowLeft className="size-[1.125rem]" strokeWidth={2} />
        </Link>

        <div className="min-w-0 flex-1 text-center sm:px-2 sm:text-left">
          <h1 className="truncate text-sm font-semibold leading-snug tracking-tight text-foreground">
            {title}
          </h1>
          {pageIndicator && (
            <p className="truncate text-xs leading-snug text-muted-foreground">
              {pageIndicator}
            </p>
          )}
        </div>

        <SettingsSheet
          onVoiceChange={onVoiceChange}
          trigger={
            <button
              type="button"
              className={cn('icon-touch size-10')}
              aria-label="Playback settings"
            >
              <Settings className="size-[1.0625rem]" strokeWidth={2} />
            </button>
          }
        />
      </div>
    </header>
  )
}
