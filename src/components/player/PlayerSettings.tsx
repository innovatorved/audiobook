import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { SpeedSlider } from '@/components/player/SpeedSlider'
import { VoicePicker } from '@/components/player/VoicePicker'
import { usePlayerStore } from '@/stores/playerStore'
import type { TtsEngineType } from '@/lib/types'

const ENGINE_OPTIONS: Array<{ id: TtsEngineType; label: string; description: string }> = [
  { id: 'kitten', label: 'Balanced', description: 'Kitten Micro — fast, ~43 MB' },
  { id: 'kokoro', label: 'Premium', description: 'Kokoro — natural voice, ~82 MB' },
  { id: 'piper', label: 'Fast CPU', description: 'Piper — WASM only, ~75 MB' },
]

interface PlayerSettingsProps {
  onEngineChange?: (engine: TtsEngineType) => void
  onVoiceChange?: (voice: string) => void
}

function SettingRow({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function PlayerSettings({ onEngineChange, onVoiceChange }: PlayerSettingsProps) {
  const {
    speed,
    setSpeed,
    voice,
    engine,
    setEngine,
    voices,
    volume,
    setVolume,
  } = usePlayerStore()

  return (
    <div className="space-y-6">
      <SettingRow
        label="Voice engine"
        hint={ENGINE_OPTIONS.find((o) => o.id === engine)?.description}
      >
        <Select
          value={engine}
          onValueChange={(v) => {
            const eng = v as TtsEngineType
            setEngine(eng)
            onEngineChange?.(eng)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENGINE_OPTIONS.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <Separator />

      <SettingRow label="Voice">
        <VoicePicker
          voices={voices}
          value={voice}
          onChange={(v) => onVoiceChange?.(v)}
          className="w-full"
        />
      </SettingRow>

      <SettingRow label="Speed">
        <SpeedSlider value={speed} onChange={setSpeed} className="w-full" />
      </SettingRow>

      <SettingRow label="Volume">
        <div className="flex items-center gap-3">
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[volume]}
            onValueChange={([v]) => setVolume(v)}
            className="flex-1"
          />
          <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">
            {Math.round(volume * 100)}%
          </span>
        </div>
      </SettingRow>
    </div>
  )
}
