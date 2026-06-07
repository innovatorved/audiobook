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
            ? 'h-dvh max-h-dvh shadow-[-12px_0_40px_rgb(28_28_34/0.08)]'
            : 'h-[92dvh] max-h-[92dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgb(28_28_34/0.1)]',
        )}
      >
        <SheetHeader className="shrink-0 px-6 py-5 text-left shadow-[0_1px_0_rgb(28_28_34/0.06)]">
          <SheetTitle className="text-base font-semibold">Settings</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <PlayerSettings onVoiceChange={onVoiceChange} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
