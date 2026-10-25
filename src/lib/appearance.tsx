import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ThemeId = 'rhodes' | 'rhine'
export type PortraitId = 'amiya' | 'priestess' | 'kaltsit'
export type AppearancePreferences = { theme: ThemeId; portrait: PortraitId }

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme: 'rhodes',
  portrait: 'amiya',
}

/** Old preference documents intentionally remain readable without rewriting their revision. */
export function parseAppearance(value: unknown): AppearancePreferences {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    theme: record.theme === 'rhine' ? 'rhine' : 'rhodes',
    portrait:
      record.portrait === 'priestess' || record.portrait === 'kaltsit' ? record.portrait : 'amiya',
  }
}

type AppearanceContext = { theme: ThemeId; applyTheme: (theme: ThemeId) => void }
const Context = createContext<AppearanceContext>({ theme: 'rhodes', applyTheme: () => {} })

export function useAppearance() {
  return useContext(Context)
}

/** Presentation state only. Saved preferences are always read from the server's SQLite store. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>('rhodes')
  const appliedVersion = useRef(0)
  const applyTheme = useCallback((next: ThemeId) => {
    ++appliedVersion.current
    setTheme(next === 'rhine' ? 'rhine' : 'rhodes')
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const version = appliedVersion.current
    const timeout = setTimeout(() => controller.abort(), 6000)
    void fetch('/api/appearance', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return
        const result: unknown = await response.json()
        // A slower initial response must not undo an authenticated preference or user selection.
        if (!controller.signal.aborted && version === appliedVersion.current)
          setTheme(parseAppearance(result).theme)
      })
      .catch(() => {
        // Login remains usable with the default presentation when this optional read fails.
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme === 'rhine' ? 'light' : 'dark'
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = theme === 'rhine' ? '#f0f2ed' : '#111315'
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (manifest)
      manifest.href = theme === 'rhine' ? '/manifest-rhine.webmanifest' : '/manifest.webmanifest'
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) {
      icon.href = theme === 'rhine' ? '/icons/rhine-lab-192.png' : '/rhodes-island.svg'
      icon.type = theme === 'rhine' ? 'image/png' : 'image/svg+xml'
    }
    const touchIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    if (touchIcon)
      touchIcon.href =
        theme === 'rhine' ? '/icons/rhine-lab-180.png' : '/icons/rhodes-island-apple-180.png'
  }, [theme])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Only the public offline page's presentation is cached. SQLite remains authoritative.
    const publish = () =>
      navigator.serviceWorker.controller?.postMessage({ type: 'PRTS_THEME', theme })
    publish()
    navigator.serviceWorker.addEventListener('controllerchange', publish)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', publish)
  }, [theme])

  return <Context.Provider value={{ theme, applyTheme }}>{children}</Context.Provider>
}
