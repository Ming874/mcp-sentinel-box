import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import type { Action } from '../data/model'
import { useT } from '../prefs'

/** The orange terminal mark shared with mingchen.dev. */
export function Logo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="sb-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F6821F" />
          <stop offset="100%" stopColor="#D95C00" />
        </linearGradient>
      </defs>
      <circle cx="256" cy="256" r="256" fill="url(#sb-logo-gradient)" />
      <g transform="translate(10, 0)">
        <polyline points="140,170 240,256 140,342" fill="none" stroke="#fff" strokeWidth="52" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="285" y1="342" x2="385" y2="342" stroke="#fff" strokeWidth="52" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className = '',
}: {
  id: string
  eyebrow: string
  title: ReactNode
  lead?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`relative py-20 sm:py-28 ${className}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-brand-ink">{eyebrow}</p>
        <h2 id={`${id}-title`} className="mt-3 max-w-4xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h2>
        {lead && <p className="mt-4 max-w-3xl text-base leading-relaxed text-fg-2 text-pretty sm:text-lg">{lead}</p>}
        <div className="mt-10 sm:mt-12">{children}</div>
      </div>
    </section>
  )
}

const actionStyle: Record<Action, string> = {
  ALLOW: 'text-allow bg-[var(--allow-soft)] border-[color-mix(in_oklab,var(--allow)_35%,transparent)]',
  ERRNO: 'text-errno bg-[var(--errno-soft)] border-[color-mix(in_oklab,var(--errno)_35%,transparent)]',
  NOTIFY: 'text-notify bg-[var(--notify-soft)] border-[color-mix(in_oklab,var(--notify)_35%,transparent)]',
  KILL: 'text-kill bg-[var(--kill-soft)] border-[color-mix(in_oklab,var(--kill)_35%,transparent)]',
}

export function ActionBadge({ action, className = '' }: { action: Action; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide ${actionStyle[action]} ${className}`}>
      {action}
    </span>
  )
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-1 font-mono text-xs text-fg-2">
      {children}
    </span>
  )
}

export function CodeBlock({ code, label, className = '' }: { code: string; label?: string; className?: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard can be unavailable (insecure context); selection still works.
    }
  }
  return (
    <div className={`term group relative overflow-hidden rounded-xl ${className}`}>
      {label && (
        <div className="flex items-center justify-between border-b border-[var(--t-line)] px-4 py-2 font-mono text-[11px] text-[var(--t-muted)]">
          <span>{label}</span>
        </div>
      )}
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--t-line)] bg-[#17171b] px-2 font-mono text-[11px] text-[var(--t-muted)] opacity-100 transition hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        aria-label={t({ zh: '複製程式碼', en: 'Copy code' })}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? t({ zh: '已複製', en: 'Copied' }) : t({ zh: '複製', en: 'Copy' })}
      </button>
      <pre className="overflow-x-auto p-4 pr-20 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)] sm:p-6 ${className}`}>{children}</div>
}
