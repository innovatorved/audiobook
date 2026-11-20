import { useEffect, useState } from 'react'
import { loadPreferences, type ThemePreference } from '@/lib/preferences'
import { applyTheme, resolveTheme, watchSystemTheme } from '@/lib/theme'

type ThemeListener = (resolved: 'light' | 'dark', pref: ThemePreference) => void
const listeners = new Set<ThemeListener>()

export function useTheme(): 'light' | 'dark' {
  const [pref, setPref] = useState<ThemePreference>(() => loadPreferences().theme)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const initialPref = loadPreferences().theme
    applyTheme(initialPref)
    return resolveTheme(initialPref)
  })

  useEffect(() => {
    const listener: ThemeListener = (resolved, nextPref) => {
      setPref(nextPref)
      setTheme(resolved)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (pref !== 'system') return

    return watchSystemTheme((next) => {
      applyTheme('system')
      setTheme(next)
    })
  }, [pref])

  return theme
}

export function setThemePreference(pref: ThemePreference): 'light' | 'dark' {
  const resolved = applyTheme(pref)
  for (const listener of listeners) {
    listener(resolved, pref)
  }
  return resolved
}
