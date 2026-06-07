import { Link } from 'react-router'
import { Headphones } from 'lucide-react'

export function HomeHeader() {
  return (
    <header className="sticky top-0 z-50 flex h-12 shrink-0 items-center border-b border-border bg-background px-4 pt-[env(safe-area-inset-top)] sm:px-6">
      <Link to="/" className="flex items-center gap-2 transition-smooth hover:opacity-80">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Headphones className="size-3.5" strokeWidth={2.25} />
        </div>
        <span className="text-sm font-semibold tracking-tight">Audiobook</span>
      </Link>
    </header>
  )
}
