import { useEffect, useState } from 'react'
import { loadPreferences, type ThemePreference } from '@/lib/preferences'
import { applyTheme, resolveTheme, watchSystemTheme } from '@/lib/theme'

export function useTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const pref = loadPreferences().theme
    applyTheme(pref)
    return resolveTheme(pref)
  })

  useEffect(() => {
    const pref = loadPreferences().theme
    if (pref !== 'system') return

    return watchSystemTheme((next) => {
      applyTheme('system')
      setTheme(next)
    })
  }, [])

  return theme
}

export function setThemePreference(pref: ThemePreference): 'light' | 'dark' {
  return applyTheme(pref)
}
