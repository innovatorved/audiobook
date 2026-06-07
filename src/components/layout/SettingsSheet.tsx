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
          'flex flex-col gap-0 p-0',
          isDesktop
            ? 'h-dvh max-h-dvh'
            : 'h-[92dvh] max-h-[92dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)]',
        )}
      >
        <SheetHeader className="shrink-0 border-b border-border px-6 py-5 text-left">
          <SheetTitle className="text-base font-semibold">Settings</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <PlayerSettings onVoiceChange={onVoiceChange} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
