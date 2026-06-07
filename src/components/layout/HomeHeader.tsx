import { Link, useLocation } from 'react-router'
import { Headphones } from 'lucide-react'
import { cn } from '@/lib/utils'

export function HomeHeader() {
  const location = useLocation()
  const isHome = location.pathname === '/'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between px-5 sm:px-8">
      <Link to="/" className="flex items-center gap-2.5 transition-smooth hover:opacity-80">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Headphones className="size-4" strokeWidth={2.25} />
        </div>
        <span className="text-[15px] font-semibold tracking-tight">Audiobook</span>
      </Link>

      <nav className="flex items-center gap-1">
        <Link
          to="/"
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-smooth',
            isHome
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Library
        </Link>
      </nav>
    </header>
  )
}
