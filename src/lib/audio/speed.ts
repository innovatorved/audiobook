export const MIN_PLAYBACK_SPEED = 0.5
export const MAX_PLAYBACK_SPEED = 3
export const PLAYBACK_SPEED_STEP = 0.1

export function clampPlaybackSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  const clamped = Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, speed))
  return Math.round(clamped * 10) / 10
}
