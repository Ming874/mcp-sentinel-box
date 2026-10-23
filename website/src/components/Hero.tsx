import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, PlayCircle, RotateCcw } from 'lucide-react'
import { GithubMark } from './icons'
import { REPO_URL } from './Header'
import { useT } from '../prefs'
import { getProfile, semantic } from '../data/model'

type Line = { text: string; tone?: 'cmd' | 'core' | 'mon' | 'sem' | 'hint' | 'out' | 'dim'; delay: number }

function buildScript(): Line[] {
  const strict = getProfile('strict')
  const fb = semantic(strict, 'socket', { 0: '2' })
  const rules = new Set(strict.syscall_rules.map((r) => r.name)).size
  return [
    { text: '$ bash scripts/run.sh -- /bin/sh -c "nc -w1 example.com 80"', tone: 'cmd', delay: 0 },
    { text: '[sentinelbox] profile=strict  rootfs=./rootfs/busybox', tone: 'core', delay: 650 },
    { text: '[sentinelbox] clone child: user·pid·mnt·net·uts·ipc·cgroup', tone: 'core', delay: 350 },
    { text: `[monitor]     policy loaded  rules=${rules}  db=WAL`, tone: 'mon', delay: 350 },
    { text: '[sentinelbox] seccomp listener ready → notify_fd via SCM_RIGHTS', tone: 'core', delay: 350 },
    { text: 'socket(AF_INET, SOCK_STREAM, 0)  ⟶  USER_NOTIF', tone: 'dim', delay: 700 },
    { text: `[SEMANTIC] ${fb.zh}`, tone: 'sem', delay: 450 },
    { text: `           HINT  → ${fb.hint}`, tone: 'hint', delay: 250 },
    { text: 'nc: socket: Operation not permitted', tone: 'out', delay: 450 },
    { text: '[monitor]     summary: mem_peak=… KiB  cpu_total=… ms', tone: 'mon', delay: 500 },
  ]
}

const toneClass: Record<NonNullable<Line['tone']>, string> = {
  cmd: 'text-white',
  core: 'text-[#a1a1aa]',
  mon: 'text-[#a1a1aa]',
  sem: 'text-[#fbbf24]',
  hint: 'text-[#fdba74]',
  out: 'text-[#f87171]',
  dim: 'text-[#71717a] italic',
}

function Terminal() {
  const t = useT()
  const script = useMemo(buildScript, [])
  const [shown, setShown] = useState(0)
  const [run, setRun] = useState(0)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setShown(script.length)
      return
    }
    setShown(0)
    let at = 400
    timers.current = script.map((line, i) => {
      at += line.delay
      return window.setTimeout(() => setShown(i + 1), at)
    })
    return () => timers.current.forEach(clearTimeout)
    // script is derived from static data; replay is driven by `run`.
  }, [run, script])

  const done = shown >= script.length
  return (
    <figure className="term relative overflow-hidden rounded-2xl shadow-2xl shadow-black/30">
      <div className="flex items-center gap-2 border-b border-[var(--t-line)] px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#3f3f46]" />
        <span className="h-3 w-3 rounded-full bg-[#3f3f46]" />
        <span className="h-3 w-3 rounded-full bg-[#3f3f46]" />
        <span className="ml-3 font-mono text-xs text-[var(--t-muted)]">sentinelbox — strict</span>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-[var(--t-muted)] transition hover:bg-white/5 hover:text-white"
        >
          <RotateCcw size={12} /> {t({ zh: '重播', en: 'Replay' })}
        </button>
      </div>
      <div className="min-h-[19.5rem] overflow-x-auto p-4 font-mono text-[12px] leading-[1.7] sm:text-[12.5px]" aria-live="off">
        {script.slice(0, shown).map((l, i) => (
          <div key={`${run}-${i}`} className={`reveal whitespace-pre-wrap break-words ${toneClass[l.tone ?? 'core']}`}>
            {l.text}
          </div>
        ))}
        {!done && <span className="caret" />}
      </div>
      <figcaption className="border-t border-[var(--t-line)] px-4 py-2.5 font-mono text-[11px] text-[var(--t-muted)]">
        {t({
          zh: '示意重播：訊息格式與語意文字取自原始碼與 mappings/syscall_feedback.json；PID、耗時等數值省略。',
          en: 'Illustrative replay — message formats come from the source; the monitor prints the Chinese strings from mappings/syscall_feedback.json. PIDs and timings omitted.',
        })}
      </figcaption>
    </figure>
  )
}

export function Hero() {
  const t = useT()
  const facts = [
    { k: '7', v: t({ zh: '個 namespace，一次 clone() 建立', en: 'namespaces from a single clone()' }) },
    { k: '4', v: t({ zh: '種 seccomp 動作：ALLOW · ERRNO · NOTIFY · KILL', en: 'seccomp actions: ALLOW · ERRNO · NOTIFY · KILL' }) },
    { k: '100 ms', v: t({ zh: 'cgroup v2 資源取樣週期', en: 'cgroup v2 sampling interval' }) },
    { k: '13', v: t({ zh: '項高風險 capability 移除（含 bounding set）', en: 'dangerous capabilities dropped, incl. bounding set' }) },
  ]
  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="pointer-events-none absolute -top-40 right-[-10%] -z-10 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(246_130_31/0.22),transparent)] blur-2xl" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
            <span className="rounded-full border border-[var(--brand-line)] bg-brand-soft px-2.5 py-1 text-brand-ink">Model Context Protocol</span>
            <span className="rounded-full border border-line px-2.5 py-1">Rootless · Linux 5.15+</span>
            <span className="rounded-full border border-line px-2.5 py-1">C · Rust · TypeScript</span>
          </div>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-balance sm:text-5xl lg:text-[3.15rem]">
            {t({
              zh: (
                <>
                  隔離 AI 寫的程式碼，
                  <br />
                  <span className="text-brand">也告訴它為什麼失敗。</span>
                </>
              ),
              en: (
                <>
                  Isolate AI&#8209;written code at the kernel — <span className="text-brand">and tell the agent why it failed.</span>
                </>
              ),
            })}
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fg-2 text-pretty sm:text-lg">
            {t({
              zh: 'SentinelBox 以 Linux namespaces、OverlayFS、seccomp USER_NOTIF 與 cgroup v2 隔離執行。每一次被攔下的系統呼叫，都會由 Rust 監控器轉成 AI 可據以修正的語意回饋，並透過 Model Context Protocol 提供給 Agent。',
              en: 'SentinelBox isolates execution with Linux namespaces, OverlayFS, seccomp USER_NOTIF and cgroup v2. Every blocked syscall is turned by a Rust monitor into feedback the agent can act on, and exposed over the Model Context Protocol.',
            })}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#architecture" className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-lg shadow-[rgb(246_130_31/0.25)] transition hover:brightness-110">
              {t({ zh: '看系統架構', en: 'Explore the architecture' })}
              <ArrowRight size={16} />
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-surface px-5 text-sm font-semibold transition hover:bg-surface-2">
              <GithubMark size={16} /> {t({ zh: '原始碼', en: 'Source code' })}
            </a>
            <a href="#demo" className="inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-fg-2 transition hover:text-fg">
              <PlayCircle size={18} /> {t({ zh: '觀看 Demo', en: 'Watch the demo' })}
            </a>
          </div>
        </div>
        <Terminal />
      </div>

      <div className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.k} className="bg-surface p-5 sm:p-6">
            <dt className="sr-only">{f.v}</dt>
            <dd className="font-mono text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{f.k}</dd>
            <dd className="mt-1.5 text-sm leading-snug text-muted">{f.v}</dd>
          </div>
        ))}
      </dl>
      </div>
    </section>
  )
}
