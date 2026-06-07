import { Headphones } from 'lucide-react'
import { cn } from '@/lib/utils'

type AppLogoSize = 'sm' | 'md' | 'lg'

const SIZE: Record<
  AppLogoSize,
  { frame: string; icon: string; radius: string; stroke: number }
> = {
  sm: { frame: 'size-7', icon: 'size-3.5', radius: 'rounded-md', stroke: 2.25 },
  md: { frame: 'size-11', icon: 'size-5', radius: 'rounded-xl', stroke: 2.25 },
  lg: { frame: 'size-20', icon: 'size-10', radius: 'rounded-2xl', stroke: 2 },
}

interface AppLogoProps {
  size?: AppLogoSize
  className?: string
  rich?: boolean
}

export function AppLogo({ size = 'sm', className, rich = false }: AppLogoProps) {
  const dims = SIZE[size]
  const useRichFrame = rich || size === 'lg'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-primary-foreground',
        useRichFrame
          ? 'bg-gradient-to-br from-primary via-primary to-indigo-700 shadow-md shadow-primary/25 ring-1 ring-white/15'
          : 'bg-primary',
        dims.frame,
        dims.radius,
        className,
      )}
    >
      <Headphones className={dims.icon} strokeWidth={dims.stroke} aria-hidden />
    </span>
  )
}
