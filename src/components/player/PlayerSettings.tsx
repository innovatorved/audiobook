import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { RecommendedBadge } from '@/components/player/RecommendedBadge'
import { SpeedSlider } from '@/components/player/SpeedSlider'
import { VoicePicker } from '@/components/player/VoicePicker'
import { ENGINE_OPTIONS } from '@/lib/tts/engineOptions'
import { rememberVoiceForEngine, savePreferences } from '@/lib/preferences'
import { usePlayerStore } from '@/stores/playerStore'
import type { TtsEngineType } from '@/lib/types'

interface PlayerSettingsProps {
  onEngineChange?: (engine: TtsEngineType) => void
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

export function PlayerSettings({ onEngineChange, onVoiceChange }: PlayerSettingsProps) {
  const {
    speed,
    setSpeed,
    voice,
    engine,
    isModelLoading,
    setVoice,
    voices,
    volume,
    setVolume,
  } = usePlayerStore()

  const engineMeta = ENGINE_OPTIONS.find((o) => o.id === engine)

  return (
    <div className="space-y-8">
      <SettingRow label="Voice engine" hint={engineMeta?.description}>
        <Select
          value={engine}
          disabled={isModelLoading}
          onValueChange={(v) => {
            onEngineChange?.(v as TtsEngineType)
          }}
        >
          <SelectTrigger
            className="h-12 w-full justify-between rounded-xl border-border bg-card px-4 text-base font-medium"
            aria-label="Voice engine"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENGINE_OPTIONS.map((opt) => (
              <SelectItem key={opt.id} value={opt.id} className="py-2.5">
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{opt.label}</span>
                    {opt.recommended && <RecommendedBadge />}
                  </span>
                  <span className="text-xs text-muted-foreground">{opt.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Voice">
        <VoicePicker
          voices={voices}
          value={voices.some((v) => v.id === voice) ? voice : (voices[0]?.id ?? voice)}
          onChange={(v) => {
            setVoice(v)
            rememberVoiceForEngine(engine, v)
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
