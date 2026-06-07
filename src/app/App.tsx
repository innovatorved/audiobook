import { useEffect } from 'react'
import { RouterProvider } from 'react-router/dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { router } from '@/app/routes'
import { applyPreferencesToStore } from '@/lib/preferences'
import { switchEngine } from '@/lib/tts/ttsWorkerManager'

export function App() {
  useEffect(() => {
    applyPreferencesToStore()
    void switchEngine('kitten')
  }, [])

  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  )
}
