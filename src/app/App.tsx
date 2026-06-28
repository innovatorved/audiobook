import { useEffect } from 'react'
import { RouterProvider } from 'react-router/dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { router } from '@/app/routes'
import { applyPreferencesToStore, loadPreferences } from '@/lib/preferences'
import { applyTheme } from '@/lib/theme'
import { useTheme } from '@/hooks/useTheme'
import { activateBrowserEngine, warmBrowserVoices } from '@/lib/tts/browserSpeech'
import { preloadKittenModelAssets } from '@/lib/tts/kittenDownload'
import { prepareKittenInBackground } from '@/lib/tts/ttsWorkerManager'
import { usePlayerStore } from '@/stores/playerStore'

function AppContent() {
  const theme = useTheme()

  useEffect(() => {
    applyTheme(loadPreferences().theme)
    const prefs = applyPreferencesToStore()

    void warmBrowserVoices().then((voices) => {
      if (prefs.engine === 'browser') {
        void activateBrowserEngine()
        return
      }

      if (voices.length > 0) {
        usePlayerStore.setState({
          isModelReady: true,
          engineReady: true,
          modelStatus: 'ready',
        })
      }

      preloadKittenModelAssets()
      prepareKittenInBackground()
    })
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
