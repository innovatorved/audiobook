import { Outlet, useLocation } from 'react-router'
import { AppHeader, MobileNav } from '@/components/layout/AppNav'

export function AppShell() {
  const location = useLocation()
  const isReader = location.pathname.startsWith('/read/')

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {!isReader && <AppHeader />}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
      {!isReader && <MobileNav />}
    </div>
  )
}
