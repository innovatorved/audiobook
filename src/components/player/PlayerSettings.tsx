import type { ReactNode } from 'react'
import { Slider } from '@/components/ui/slider'
import { SpeedSlider } from '@/components/player/SpeedSlider'
import { VoicePicker } from '@/components/player/VoicePicker'
import { rememberVoice, savePreferences } from '@/lib/preferences'
import { usePlayerStore } from '@/stores/playerStore'

interface PlayerSettingsProps {
  onVoiceChange?: (voice: string) => void
}

function SettingRow({
  label,
  value,
  hint,
  children,
}: {
  label: string
  value?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium text-foreground">
          {label}
        </label>
        {value && (
          <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
        )}
      </div>
      {children}
      {hint && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </section>
  )
}

export function PlayerSettings({ onVoiceChange }: PlayerSettingsProps) {
  const {
    speed,
    setSpeed,
    voice,
    voices,
    setVoice,
    volume,
    setVolume,
  } = usePlayerStore()

  return (
    <div className="space-y-8">
      <SettingRow label="Voice">
        <VoicePicker
          voices={voices}
          value={voices.some((v) => v.id === voice) ? voice : (voices[0]?.id ?? voice)}
          onChange={(v) => {
            setVoice(v)
            rememberVoice(v)
            onVoiceChange?.(v)
          }}
          className="w-full"
        />
      </SettingRow>

      <SettingRow label="Speed" value={`${speed.toFixed(1)}×`}>
        <SpeedSlider
          value={speed}
          onChange={(v) => {
            setSpeed(v)
            savePreferences({ speed: v })
          }}
          className="w-full"
        />
      </SettingRow>

      <SettingRow label="Volume" value={`${Math.round(volume * 100)}%`}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[volume]}
          onValueChange={([v]) => {
            setVolume(v)
            savePreferences({ volume: v })
          }}
          aria-label="Volume"
          className="w-full"
        />
      </SettingRow>
    </div>
  )
}
