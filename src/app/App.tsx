import { useEffect } from 'react'
import { RouterProvider } from 'react-router/dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { router } from '@/app/routes'
import { applyPreferencesToStore, loadPreferences } from '@/lib/preferences'
import { applyTheme } from '@/lib/theme'
import { useTheme } from '@/hooks/useTheme'
import { switchEngine } from '@/lib/tts/ttsWorkerManager'
import { prepareBrowserTts } from '@/lib/tts/browserSpeech'

function AppContent() {
  const theme = useTheme()

  useEffect(() => {
    applyTheme(loadPreferences().theme)
    const prefs = applyPreferencesToStore()
    if (prefs.engine === 'browser') {
      void prepareBrowserTts()
    } else {
      void switchEngine('kitten')
    }
  }, [])

  return (
    <>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" closeButton theme={theme} />
    </>
  )
}

export function App() {
  return (
    <TooltipProvider>
      <AppContent />
    </TooltipProvider>
  )
}
