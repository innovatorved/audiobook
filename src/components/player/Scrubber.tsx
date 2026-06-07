import { Slider } from '@/components/ui/slider'

interface ScrubberProps {
  value: number
  max: number
  onChange: (index: number) => void
}

export function Scrubber({ value, max, onChange }: ScrubberProps) {
  if (max <= 0) return null

  return (
    <Slider
      min={0}
      max={max}
      step={1}
      value={[value]}
      onValueChange={([v]) => onChange(v)}
      className="flex-1 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:shadow-sm"
    />
  )
}
