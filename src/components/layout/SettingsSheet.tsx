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
}

export function SettingsSheet({ trigger, onVoiceChange }: SettingsSheetProps) {
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const side = isDesktop ? 'right' : 'bottom'

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side={side}
        showCloseButton
        className={cn(
          'flex flex-col gap-0 border-0 p-0 shadow-none',
          isDesktop
            ? 'h-dvh max-h-dvh shadow-[-12px_0_40px_rgb(0_0_0/0.35)]'
            : 'h-[92dvh] max-h-[92dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgb(0_0_0/0.4)]',
        )}
      >
        <SheetHeader className="shrink-0 border-b border-border px-6 py-5 text-left">
          <SheetTitle className="text-base font-bold">Playback</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <PlayerSettings onVoiceChange={onVoiceChange} />
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4">
          <Link
            to="/settings"
            className="text-sm font-semibold text-foreground transition-smooth hover:underline"
          >
            All settings
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}
