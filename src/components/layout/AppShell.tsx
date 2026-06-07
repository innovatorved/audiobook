import { Outlet, useLocation } from 'react-router'
import { HomeHeader } from '@/components/layout/HomeHeader'

export function AppShell() {
  const location = useLocation()
  const isReader = location.pathname.startsWith('/read/')

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {!isReader && <HomeHeader />}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
