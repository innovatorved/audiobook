import { useEffect } from 'react'
import { RouterProvider } from 'react-router/dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { router } from '@/app/routes'
import { applyPreferencesToStore } from '@/lib/preferences'

export function App() {
  useEffect(() => {
    applyPreferencesToStore()
  }, [])

  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  )
}
