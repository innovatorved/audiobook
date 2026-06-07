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
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('w-full', className)}>
        <SelectValue placeholder="Select voice" />
      </SelectTrigger>
      <SelectContent>
        {voices.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
