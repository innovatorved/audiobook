import { useSyncExternalStore } from 'react'

function subscribe(query: string) {
  return (callback: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', callback)
    return () => mql.removeEventListener('change', callback)
  }
}

function getSnapshot(query: string) {
  return () => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  }
}

function getServerSnapshot() {
  return false
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(subscribe(query), getSnapshot(query), getServerSnapshot)
}
