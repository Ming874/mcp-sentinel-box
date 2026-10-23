import { useState } from 'react'
import { CheckCircle2, CircleDashed, FileText, Play } from 'lucide-react'
import { CodeBlock, Section } from './ui'
import { GithubMark } from './icons'
import { REPO_URL } from './Header'
import { useT } from '../prefs'

const STEPS = [
  {
    zh: '取得原始碼並一鍵建置',
    en: 'Clone and provision',
    note: { zh: '安裝相依套件、編譯 C core 與 Rust monitor，並建立 busybox rootfs。', en: 'Installs dependencies, builds the C core and Rust monitor, and creates the busybox rootfs.' },
    code: 'git clone https://github.com/Ming874/mcp-sentinel-box.git\ncd mcp-sentinel-box\nbash scripts/provision.sh',
  },
  {
    zh: '啟動監控面板',
    en: 'Start the dashboard',
    note: { zh: 'Bridge 跑在 3001、Dashboard 跑在 3000，自動連上 sentinelbox.db。', en: 'The bridge listens on 3001 and the dashboard on 3000, attached to sentinelbox.db.' },
    code: './scripts/start_monitoring.sh\n# open http://localhost:3000',
  },
  {
    zh: '在沙盒裡執行程式碼',
    en: 'Run code in the sandbox',
    note: { zh: '另開終端機；profile 以環境變數切換。', en: 'In another terminal; switch profiles with an environment variable.' },
    code: 'bash scripts/run.sh -- /bin/sh -c "echo hello from sandbox"\nbash scripts/run.sh -- /bin/sh -c "nc -w1 example.com 80"\nSENTINELBOX_PROFILE=datascience bash scripts/run.sh -- /bin/sh -c "free -m"',
  },
]

const REQS = [
  { zh: 'Linux 5.15+，cgroup v2', en: 'Linux 5.15+ with cgroup v2' },
  { zh: 'libseccomp-dev、libcap-dev、build-essential', en: 'libseccomp-dev, libcap-dev, build-essential' },
  { zh: 'Rust stable、Node.js 22+', en: 'Rust stable, Node.js 22+' },
  { zh: 'busybox-static（rootfs）', en: 'busybox-static (rootfs)' },
]

const ROADMAP = {
  done: [
    { zh: 'Phase 1 · 容器原語：namespaces、pivot_root、OverlayFS、cgroup v2、libcap', en: 'Phase 1 · Container primitives: namespaces, pivot_root, OverlayFS, cgroup v2, libcap' },
    { zh: 'Phase 2 · 安全哨兵：Rust、seccomp USER_NOTIF、SCM_RIGHTS', en: 'Phase 2 · Security sentinel: Rust, seccomp USER_NOTIF, SCM_RIGHTS' },
    { zh: 'Phase 3 · 遙測與資料庫：cgroup v2 取樣、SQLite WAL 稽核', en: 'Phase 3 · Telemetry & database: cgroup v2 sampling, SQLite WAL audit' },
    { zh: 'Phase 4 · MCP 整合：TypeScript SDK、自我修復閉環', en: 'Phase 4 · MCP integration: TypeScript SDK, self-repair loop' },
    { zh: 'Phase 5 · 管理介面：React、Tailwind、Socket.io', en: 'Phase 5 · Management UI: React, Tailwind, Socket.io' },
  ],
  next: [
    { zh: 'eBPF probe（aya、execve tracepoint、cgroup_skb）——目前 monitor/src/ebpf 為保留骨架', en: 'eBPF probes (aya, execve tracepoint, cgroup_skb) — monitor/src/ebpf is a placeholder today' },
    { zh: 'veth 與出站白名單，讓 web / datascience 的網路政策真正生效', en: 'veth plus an egress allow-list so the web / datascience network policy takes effect' },
    { zh: '從 /proc/<pid>/mem 讀取路徑參數，填入 syscall_events.path', en: 'Read path arguments via /proc/<pid>/mem to fill syscall_events.path' },
    { zh: 'MCP 工具直接查詢稽核資料庫，並共用 syscall_feedback.json', en: 'MCP tools that query the audit database and share syscall_feedback.json' },
    { zh: 'x86_64 以外的 syscall 對照表（aarch64）', en: 'Syscall tables beyond x86_64 (aarch64)' },
  ],
}

const VIDEO_ID = 'ZsGC6J98llk'

function Demo() {
  const t = useT()
  const [load, setLoad] = useState(false)
  return (
    <div id="demo" className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow)]">
      <div className="relative aspect-video bg-[#0e0e11]">
        {load ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
            title="SentinelBox demo"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button type="button" onClick={() => setLoad(true)} className="group absolute inset-0 grid place-items-center text-left">
            <div className="bg-grid absolute inset-0 opacity-60" />
            <div className="relative flex flex-col items-center gap-4 px-6 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-brand text-white shadow-xl shadow-[rgb(246_130_31/0.35)] transition group-hover:scale-105">
                <Play size={26} className="translate-x-0.5" fill="currentColor" />
              </span>
              <span className="text-lg font-semibold text-white">{t({ zh: '播放 Demo 影片', en: 'Play the demo' })}</span>
              <span className="max-w-sm text-sm text-[#a1a1aa]">
                {t({ zh: '點擊後才會載入 YouTube（youtube-nocookie.com）。', en: 'YouTube (youtube-nocookie.com) loads only after you click.' })}
              </span>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}

export function GetStarted() {
  const t = useT()
  return (
    <Section
      id="quickstart"
      eyebrow={t({ zh: '開始使用', en: 'Get started' })}
      title={t({ zh: '三個指令，在自己的 Linux 上跑起來。', en: 'Three commands to run it on your own Linux box.' })}
      lead={t({
        zh: '在 Docker、VS Code Dev Container 或部分 WSL2 環境中，cgroup 無法委派時會自動降級為整機取樣，沙盒仍可執行；要取得精確的每沙盒限制，請在原生 Linux 上執行 scripts/setup_cgroup.sh。',
        en: 'Inside Docker, VS Code Dev Containers or some WSL2 setups, cgroups cannot be delegated and telemetry degrades to host-wide sampling; the sandbox still runs. For exact per-sandbox limits, run scripts/setup_cgroup.sh on native Linux.',
      })}
    >
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <ol className="space-y-6">
          {STEPS.map((s, i) => (
            <li key={s.en} className="grid grid-cols-[2rem_1fr] gap-4">
              <span className="grid h-8 w-8 place-items-center rounded-full border border-[var(--brand-line)] bg-brand-soft font-mono text-sm font-semibold text-brand-ink">{i + 1}</span>
              <div className="min-w-0">
                <h3 className="font-semibold">{t(s)}</h3>
                <p className="mt-1 text-sm text-fg-2">{t(s.note)}</p>
                <CodeBlock code={s.code} className="mt-3" />
              </div>
            </li>
          ))}
        </ol>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)]">
            <h3 className="font-semibold">{t({ zh: '環境需求', en: 'Requirements' })}</h3>
            <ul className="mt-3 space-y-2 text-sm text-fg-2">
              {REQS.map((r) => (
                <li key={r.en} className="flex gap-2.5">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-allow" />
                  {t(r)}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)]">
            <h3 className="font-semibold">{t({ zh: '更多操作', en: 'More targets' })}</h3>
            <dl className="mt-3 space-y-2 font-mono text-[13px]">
              {[
                ['make test', t({ zh: '整合測試：hello、網路、mount、OOM', en: 'integration tests: hello, network, mount, OOM' })],
                ['make rootfs', t({ zh: '重建 busybox rootfs', en: 'rebuild the busybox rootfs' })],
                ['man ./docs/sentinelbox.1', t({ zh: '指令與 profile 手冊', en: 'CLI and profile manual' })],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-fg">{k}</dt>
                  <dd className="font-sans text-xs text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>

      <div className="mt-20 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">{t({ zh: '實際運作', en: 'See it run' })}</h3>
          <p className="mt-2 text-sm text-fg-2 sm:text-base">
            {t({ zh: '從攔截網路連線、即時資源圖表到 AI 自我修正的完整示範。', en: 'From blocking a network call to live resource charts and an agent correcting itself.' })}
          </p>
          <div className="mt-6">
            <Demo />
          </div>
        </div>
        <div id="roadmap" className="scroll-mt-24">
          <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">{t({ zh: '進度與下一步', en: 'Status & roadmap' })}</h3>
          <ul className="mt-6 space-y-3 text-sm">
            {ROADMAP.done.map((r) => (
              <li key={r.en} className="flex gap-3 text-fg-2">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-allow" />
                {t(r)}
              </li>
            ))}
          </ul>
          <ul className="mt-6 space-y-3 border-t border-line pt-6 text-sm">
            {ROADMAP.next.map((r) => (
              <li key={r.en} className="flex gap-3 text-muted">
                <CircleDashed size={17} className="mt-0.5 shrink-0" />
                {t(r)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-20 grid gap-4 sm:grid-cols-3">
        <a href="/Report.pdf" target="_blank" rel="noreferrer" className="group rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)] transition hover:border-[var(--brand-line)]">
          <FileText className="text-brand-ink" size={22} />
          <h3 className="mt-3 font-semibold">{t({ zh: '技術報告書', en: 'Technical report' })}</h3>
          <p className="mt-1 text-sm text-muted">PDF · 20 {t({ zh: '頁', en: 'pages' })}</p>
        </a>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="group rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)] transition hover:border-[var(--brand-line)]">
          <GithubMark size={22} />
          <h3 className="mt-3 font-semibold">{t({ zh: '原始碼', en: 'Source code' })}</h3>
          <p className="mt-1 text-sm text-muted">Ming874/mcp-sentinel-box · MIT</p>
        </a>
        <a href={`${REPO_URL}/blob/main/docs/WIKI.md`} target="_blank" rel="noreferrer" className="group rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)] transition hover:border-[var(--brand-line)]">
          <FileText className="text-brand-ink" size={22} />
          <h3 className="mt-3 font-semibold">{t({ zh: '技術文件', en: 'Documentation' })}</h3>
          <p className="mt-1 text-sm text-muted">WIKI · ARCHITECTURE · db-schema</p>
        </a>
      </div>
    </Section>
  )
}
