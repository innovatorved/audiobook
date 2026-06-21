import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { savePreferences, type ThemePreference } from '@/lib/preferences'
import { setThemePreference } from '@/hooks/useTheme'
import { useState } from 'react'
import { loadPreferences } from '@/lib/preferences'

export function AppearanceSettings() {
  const [theme, setTheme] = useState<ThemePreference>(() => loadPreferences().theme)

  const handleThemeChange = (value: ThemePreference) => {
    setTheme(value)
    savePreferences({ theme: value })
    setThemePreference(value)
  }

  return (
    <div className="surface-panel px-5 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="theme-select" className="text-sm font-medium text-foreground">
          Theme
        </label>
      </div>
      <Select value={theme} onValueChange={(v) => handleThemeChange(v as ThemePreference)}>
        <SelectTrigger id="theme-select" className="mt-3 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
          <SelectItem value="system">System</SelectItem>
        </SelectContent>
      </Select>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Dark is the default media player look. Light uses a brighter variant for daytime use.
      </p>
    </div>
  )
}
