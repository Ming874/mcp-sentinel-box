import { Logo } from './ui'
import { REPO_URL } from './Header'
import { useT } from '../prefs'

export function Footer() {
  const t = useT()
  const links = [
    { href: '#architecture', label: t({ zh: '架構', en: 'Architecture' }) },
    { href: '#decisions', label: t({ zh: '決策路徑', en: 'Syscall path' }) },
    { href: '#defense', label: t({ zh: '防禦層', en: 'Defense' }) },
    { href: '#telemetry', label: t({ zh: '遙測與稽核', en: 'Telemetry' }) },
    { href: '#mcp', label: 'MCP' },
    { href: '#quickstart', label: t({ zh: '開始使用', en: 'Get started' }) },
  ]
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <a href="#top" className="inline-flex items-center gap-2.5 font-semibold">
            <Logo size={26} /> SentinelBox
          </a>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
            {t({
              zh: '為 AI Agent 打造的 rootless Linux 沙盒：核心層隔離、即時遙測，並把每一次攔截轉成可行動的語意回饋。',
              en: 'A rootless Linux sandbox for AI agents: kernel-level isolation, live telemetry, and actionable feedback for every interception.',
            })}
          </p>
        </div>
        <nav aria-label={t({ zh: '頁尾導覽', en: 'Footer' })}>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{t({ zh: '導覽', en: 'Explore' })}</p>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm md:grid-cols-1">
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="text-fg-2 transition hover:text-brand-ink">{l.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{t({ zh: '資源', en: 'Resources' })}</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><a href={REPO_URL} target="_blank" rel="noreferrer" className="text-fg-2 transition hover:text-brand-ink">GitHub</a></li>
            <li><a href="/Report.pdf" target="_blank" rel="noreferrer" className="text-fg-2 transition hover:text-brand-ink">{t({ zh: '技術報告書（PDF）', en: 'Technical report (PDF)' })}</a></li>
            <li><a href="mailto:contact@mingchen.dev" className="text-fg-2 transition hover:text-brand-ink">contact@mingchen.dev</a></li>
            <li><a href="https://mingchen.dev" target="_blank" rel="noreferrer" className="text-fg-2 transition hover:text-brand-ink">mingchen.dev</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© 2026 Ming Chen · MIT License</p>
          <p className="font-mono">C · Rust · TypeScript · Linux 5.15+</p>
        </div>
      </div>
    </footer>
  )
}
