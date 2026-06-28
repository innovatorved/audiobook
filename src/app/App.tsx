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
import { preloadKittenModelAssets } from '@/lib/tts/kittenDownload'

function AppContent() {
  const theme = useTheme()

  useEffect(() => {
    applyTheme(loadPreferences().theme)
    const prefs = applyPreferencesToStore()

    void prepareBrowserTts()

    if (prefs.engine === 'browser') {
      return
    }

    preloadKittenModelAssets()
    void switchEngine('kitten')
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
