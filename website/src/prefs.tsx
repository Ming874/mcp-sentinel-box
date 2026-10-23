import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'zh' | 'en'
export type Theme = 'light' | 'dark'

type Prefs = {
  lang: Lang
  theme: Theme
  setLang: (lang: Lang) => void
  toggleTheme: () => void
}

const PrefsContext = createContext<Prefs | null>(null)

function readAttr(): { lang: Lang; theme: Theme } {
  // index.html resolves both before first paint; mirror what it decided.
  const d = document.documentElement
  return {
    lang: d.lang.startsWith('zh') ? 'zh' : 'en',
    theme: d.dataset.theme === 'light' ? 'light' : 'dark',
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the choice just won't persist.
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readAttr)

  useEffect(() => {
    const d = document.documentElement
    d.lang = state.lang === 'zh' ? 'zh-Hant-TW' : 'en'
    d.dataset.theme = state.theme
  }, [state])

  const setLang = useCallback((lang: Lang) => {
    store('sb-lang', lang)
    setState((s) => ({ ...s, lang }))
  }, [])

  const toggleTheme = useCallback(() => {
    setState((s) => {
      const theme: Theme = s.theme === 'dark' ? 'light' : 'dark'
      store('sb-theme', theme)
      return { ...s, theme }
    })
  }, [])

  const value = useMemo(() => ({ ...state, setLang, toggleTheme }), [state, setLang, toggleTheme])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider')
  return ctx
}

/** Pick the string for the active language. */
export function useT() {
  const { lang } = usePrefs()
  return useCallback(<T,>(pair: { zh: T; en: T }): T => pair[lang], [lang])
}
