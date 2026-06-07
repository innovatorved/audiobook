import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

interface SpeedSliderProps {
  value: number
  onChange: (value: number) => void
  className?: string
}

export function SpeedSlider({ value, onChange, className }: SpeedSliderProps) {
  return (
    <Slider
      min={0.5}
      max={4.5}
      step={0.1}
      value={[value]}
      onValueChange={([v]) => onChange(v)}
      aria-label="Playback speed"
      className={cn('w-full', className)}
    />
  )
}
