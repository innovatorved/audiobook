import { PlayerSettings } from '@/components/player/PlayerSettings'
import { AppearanceSettings } from '@/components/settings/AppearanceSettings'

export function SettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-8 pb-[max(5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Playback and appearance preferences apply across the app.
        </p>

        <div className="mt-8 space-y-10">
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Appearance
            </h2>
            <div className="mt-4">
              <AppearanceSettings />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Playback
            </h2>
            <div className="surface-panel mt-4 px-5 py-6">
              <PlayerSettings />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
