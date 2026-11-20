import { useState } from 'react'
import { Link } from 'react-router'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { PlayerSettings } from '@/components/player/PlayerSettings'
import { cn } from '@/lib/utils'

interface SettingsSheetProps {
  trigger: React.ReactNode
  onVoiceChange?: (voice: string) => void
  onSpeedChange?: (speed: number) => void
}

export function SettingsSheet({ trigger, onVoiceChange, onSpeedChange }: SettingsSheetProps) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const side = isDesktop ? 'right' : 'bottom'

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side={side}
        showCloseButton
        className={cn(
          'flex flex-col gap-0 border-0 p-0 shadow-none',
          isDesktop
            ? 'h-dvh max-h-dvh shadow-[-12px_0_40px_rgb(0_0_0/0.35)]'
            : 'h-[88dvh] max-h-[88dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgb(0_0_0/0.4)]',
        )}
      >
        {!isDesktop && (
          <div className="flex shrink-0 justify-center pt-2.5 pb-0.5" aria-hidden>
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
        )}

        <SheetHeader className="shrink-0 border-b border-border px-6 py-4 text-left sm:py-5">
          <SheetTitle className="text-base font-bold">Playback</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overscroll-y-contain px-6 py-6">
          <PlayerSettings onVoiceChange={onVoiceChange} onSpeedChange={onSpeedChange} />
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4">
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-10 items-center text-sm font-semibold text-foreground transition-smooth hover:underline"
          >
            All settings
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}
