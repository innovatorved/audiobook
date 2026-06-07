import { Link } from 'react-router'
import { AppLogo } from '@/components/brand/AppLogo'

export function HomeHeader() {
  return (
    <header className="sticky top-0 z-50 flex h-12 shrink-0 items-center border-b border-border bg-background px-4 pt-[env(safe-area-inset-top)] sm:px-6">
      <Link to="/" className="flex items-center gap-2.5 transition-smooth hover:opacity-85">
        <AppLogo size="sm" />
        <span className="text-sm font-semibold tracking-tight">Audiobook</span>
      </Link>
    </header>
  )
}
