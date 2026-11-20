import { useState } from 'react'
import { Slider } from '@/components/ui/slider'

interface ScrubberProps {
  value: number
  max: number
  onChange: (index: number) => void
}

export function Scrubber({ value, max, onChange }: ScrubberProps) {
  const [draft, setDraft] = useState<number | null>(null)

  if (max <= 0) return null

  const displayValue = draft ?? value

  return (
    <Slider
      min={0}
      max={max}
      step={1}
      value={[displayValue]}
      onValueChange={([v]) => setDraft(v)}
      onValueCommit={([v]) => {
        setDraft(null)
        if (v !== value) {
          onChange(v)
        }
      }}
      aria-label="Sentence progress"
      className={[
        'flex-1 py-2',
        '[&_[data-slot=slider-track]]:h-1.5',
        '[&_[data-slot=slider-thumb]]:size-4',
      ].join(' ')}
    />
  )
}
