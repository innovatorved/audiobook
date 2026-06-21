import { Link, useLocation } from 'react-router'
import { Home, Library, Settings } from 'lucide-react'
import { AppLogo } from '@/components/brand/AppLogo'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/library', label: 'Library', icon: Library, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const

function isActive(pathname: string, to: string, end: boolean): boolean {
  if (end) return pathname === to
  return pathname.startsWith(to)
}

export function AppHeader() {
  const { pathname } = useLocation()

  return (
    <header className="chrome-bar sticky top-0 z-50 flex h-12 shrink-0 items-center justify-between px-4 pt-[env(safe-area-inset-top)] sm:px-6">
      <Link to="/" className="flex items-center gap-2.5 transition-smooth hover:opacity-85">
        <AppLogo size="sm" />
        <span className="text-sm font-bold tracking-tight">Audiobook</span>
      </Link>

      <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
        {NAV_ITEMS.map(({ to, label, end }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-semibold transition-smooth',
              isActive(pathname, to, end)
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  )
}

export function MobileNav() {
  const { pathname } = useLocation()

  return (
    <nav
      className="chrome-bar flex h-14 shrink-0 items-stretch border-t border-border pb-[env(safe-area-inset-bottom)] sm:hidden"
      aria-label="Main"
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => {
        const active = isActive(pathname, to, end)
        return (
          <Link
            key={to}
            to={to}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-smooth',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-5" strokeWidth={active ? 2.25 : 2} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
