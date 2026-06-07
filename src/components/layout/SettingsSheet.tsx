import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { PlayerSettings } from '@/components/player/PlayerSettings'
import type { TtsEngineType } from '@/lib/types'

interface SettingsSheetProps {
  trigger: React.ReactNode
  onEngineChange?: (engine: TtsEngineType) => void
  onVoiceChange?: (voice: string) => void
}

export function SettingsSheet({ trigger, onEngineChange, onVoiceChange }: SettingsSheetProps) {
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const side = isDesktop ? 'right' : 'bottom'

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side={side}
        showCloseButton
        className="flex max-h-[min(92dvh,640px)] flex-col gap-0 p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader className="shrink-0 border-b border-border px-6 py-5 text-left">
          <SheetTitle className="text-base font-semibold">Settings</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <PlayerSettings
            onEngineChange={onEngineChange}
            onVoiceChange={onVoiceChange}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
