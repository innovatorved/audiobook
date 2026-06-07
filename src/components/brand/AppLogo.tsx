import { cn } from '@/lib/utils'

type AppLogoSize = 'sm' | 'md' | 'lg'

const SIZE: Record<
  AppLogoSize,
  { frame: string; icon: string; radius: string }
> = {
  sm: { frame: 'size-8', icon: 'size-4', radius: 'rounded-lg' },
  md: { frame: 'size-11', icon: 'size-6', radius: 'rounded-xl' },
  lg: { frame: 'size-20', icon: 'size-11', radius: 'rounded-2xl' },
}

interface AppLogoProps {
  size?: AppLogoSize
  className?: string
  showFrame?: boolean
}

export function AppLogo({ size = 'sm', className, showFrame = true }: AppLogoProps) {
  const dims = SIZE[size]

  const icon = (
    <img
      src="/favicon.svg"
      alt=""
      aria-hidden
      className={cn(dims.icon, 'select-none')}
      draggable={false}
    />
  )

  if (!showFrame) {
    return <span className={cn('inline-flex shrink-0', className)}>{icon}</span>
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        'bg-gradient-to-br from-primary via-primary to-indigo-700',
        'shadow-md shadow-primary/25 ring-1 ring-white/15',
        dims.frame,
        dims.radius,
        className,
      )}
    >
      {icon}
    </span>
  )
}
