import { useEffect, useState } from 'react'
import { Menu, Moon, Sun, X } from 'lucide-react'
import { Logo } from './ui'
import { GithubMark } from './icons'
import { usePrefs, useT } from '../prefs'

export const REPO_URL = 'https://github.com/Ming874/mcp-sentinel-box'

const NAV = [
  { id: 'architecture', zh: '架構', en: 'Architecture' },
  { id: 'decisions', zh: '決策路徑', en: 'Syscall path' },
  { id: 'defense', zh: '防禦層', en: 'Defense' },
  { id: 'telemetry', zh: '遙測與稽核', en: 'Telemetry' },
  { id: 'mcp', zh: 'MCP', en: 'MCP' },
  { id: 'quickstart', zh: '開始使用', en: 'Get started' },
] as const

function useActiveSection() {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const els = NAV.map((n) => document.getElementById(n.id)).filter((el): el is HTMLElement => !!el)
    const visible = new Map<string, number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0)
        let best: string | null = null
        let bestRatio = 0
        for (const [id, r] of visible) if (r > bestRatio) [best, bestRatio] = [id, r]
        setActive(best)
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.01, 0.25, 0.5] },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return active
}

export function Header() {
  const { lang, setLang, theme, toggleTheme } = usePrefs()
  const t = useT()
  const active = useActiveSection()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  const langToggle = (
    <div role="group" aria-label={t({ zh: '語言', en: 'Language' })} className="flex rounded-lg border border-line p-0.5 font-mono text-xs">
      {(['zh', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`rounded-md px-2 py-1 transition ${lang === l ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg'}`}
        >
          {l === 'zh' ? '中' : 'EN'}
        </button>
      ))}
    </div>
  )

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] ${
        scrolled || open ? 'border-b border-line bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] backdrop-blur-xl' : 'border-b border-transparent'
      }`}
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        {t({ zh: '跳到主要內容', en: 'Skip to content' })}
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5 font-semibold tracking-tight" aria-label="SentinelBox">
          <Logo size={28} />
          <span>SentinelBox</span>
        </a>

        <nav aria-label={t({ zh: '主選單', en: 'Primary' })} className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              aria-current={active === n.id ? 'true' : undefined}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                active === n.id ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:text-fg'
              }`}
            >
              {t(n)}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">{langToggle}</div>
          <button
            type="button"
            onClick={toggleTheme}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition hover:text-fg"
            aria-label={theme === 'dark' ? t({ zh: '切換為淺色', en: 'Switch to light theme' }) : t({ zh: '切換為深色', en: 'Switch to dark theme' })}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 items-center gap-2 rounded-lg bg-fg px-3 text-sm font-medium text-bg transition hover:opacity-90 sm:inline-flex"
          >
            <GithubMark size={16} />
            GitHub
          </a>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-lg border border-line lg:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? t({ zh: '關閉選單', en: 'Close menu' }) : t({ zh: '開啟選單', en: 'Open menu' })}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-nav" className="h-[calc(100dvh-4rem)] overflow-y-auto border-t border-line bg-bg px-4 pb-10 pt-4 lg:hidden">
          <nav aria-label={t({ zh: '主選單', en: 'Primary' })} className="flex flex-col">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={() => setOpen(false)} className="border-b border-line py-4 text-lg font-medium">
                {t(n)}
              </a>
            ))}
          </nav>
          <div className="mt-8 flex items-center justify-between">
            {langToggle}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg bg-fg px-4 text-sm font-medium text-bg">
              <GithubMark size={16} />
              GitHub
            </a>
          </div>
        </div>
      )}
    </header>
  )
}
