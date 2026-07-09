import { Headphones } from 'lucide-react'
import { cn } from '@/lib/utils'

type AppLogoSize = 'sm' | 'md' | 'lg'

const SIZE: Record<
  AppLogoSize,
  { frame: string; icon: string; radius: string; stroke: number }
> = {
  sm: { frame: 'size-7', icon: 'size-3.5', radius: 'rounded-full', stroke: 2.25 },
  md: { frame: 'size-11', icon: 'size-5', radius: 'rounded-xl', stroke: 2.25 },
  lg: { frame: 'size-20', icon: 'size-10', radius: 'rounded-2xl', stroke: 2 },
}

interface AppLogoProps {
  size?: AppLogoSize
  className?: string
}

export function AppLogo({ size = 'sm', className }: AppLogoProps) {
  const dims = SIZE[size]

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-primary text-primary-foreground',
        dims.frame,
        dims.radius,
        className,
      )}
    >
      <Headphones className={dims.icon} strokeWidth={dims.stroke} aria-hidden />
    </span>
  )
}
