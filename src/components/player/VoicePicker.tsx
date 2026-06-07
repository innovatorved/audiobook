import { useMemo } from 'react'
import { RecommendedBadge } from '@/components/player/RecommendedBadge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { VoiceInfo } from '@/lib/types'

interface VoicePickerProps {
  voices: VoiceInfo[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function VoicePicker({ voices, value, onChange, className }: VoicePickerProps) {
  const sorted = useMemo(
    () =>
      [...voices].sort((a, b) => {
        if (a.recommended === b.recommended) return a.label.localeCompare(b.label)
        return a.recommended ? -1 : 1
      }),
    [voices],
  )
  const selected = voices.find((v) => v.id === value)

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('w-full', className)}>
        <SelectValue placeholder="Select voice">
          {selected && (
            <span className="flex items-center gap-2">
              <span>{selected.label}</span>
              {selected.recommended && <RecommendedBadge />}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className="max-h-80 w-[var(--radix-select-trigger-width)]"
      >
        {sorted.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            <span className="flex items-center gap-2">
              <span>{v.label}</span>
              {v.recommended && <RecommendedBadge />}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
