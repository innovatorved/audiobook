import { useEffect } from 'react'
import { RouterProvider } from 'react-router/dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { router } from '@/app/routes'
import { applyPreferencesToStore } from '@/lib/preferences'
import { switchEngine } from '@/lib/tts/ttsWorkerManager'
import { prepareBrowserTts } from '@/lib/tts/browserSpeech'

export function App() {
  useEffect(() => {
    const prefs = applyPreferencesToStore()
    if (prefs.engine === 'browser') {
      void prepareBrowserTts()
    } else {
      void switchEngine('kitten')
    }
  }, [])

  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  )
}
