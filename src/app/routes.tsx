import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { HomePage } from '@/pages/HomePage'
import { LibraryPage } from '@/pages/LibraryPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { Skeleton } from '@/components/ui/skeleton'

const ReaderPage = lazy(() =>
  import('@/pages/ReaderPage').then((m) => ({ default: m.ReaderPage })),
)

function ReaderRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="min-h-0 flex-1 rounded-xl" />
        </div>
      }
    >
      <ReaderPage />
    </Suspense>
  )
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'read/:docId', element: <ReaderRoute /> },
    ],
  },
])
