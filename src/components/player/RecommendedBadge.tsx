import { cn } from '@/lib/utils'

export function RecommendedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary',
        className,
      )}
    >
      Recommended
    </span>
  )
}
