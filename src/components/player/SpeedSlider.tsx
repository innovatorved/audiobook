import { Gauge } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

interface SpeedSliderProps {
  value: number
  onChange: (value: number) => void
  className?: string
}

export function SpeedSlider({ value, onChange, className }: SpeedSliderProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5',
        className,
      )}
    >
      <Gauge className="size-4 shrink-0 text-muted-foreground" />
      <Slider
        min={0.5}
        max={4.5}
        step={0.1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
      />
      <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
        {value.toFixed(1)}×
      </span>
    </div>
  )
}
