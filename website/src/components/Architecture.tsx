import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Pause, Play } from 'lucide-react'
import { Section } from './ui'
import { useT } from '../prefs'

// Hand-built system diagram. Coordinates live in a 1200×700 viewBox; every node and
// edge below corresponds to a real component or call path in the repository.

type NodeId =
  | 'agent' | 'mcp' | 'cli' | 'sandbox' | 'monitor' | 'sqlite' | 'bridge' | 'dashboard'
  | 'seccomp' | 'cgroup' | 'procfs' | 'ns'

type Box = { x: number; y: number; w: number; h: number }

type DiagramNode = Box & {
  id: NodeId
  title: string
  sub?: string
  rows?: string[]
  kernel?: boolean
}

type Edge = {
  id: string
  from: NodeId
  to: NodeId
  step: number
  points: [number, number][]
  both?: boolean
  dashed?: boolean
  badge?: [number, number]
  label?: { x: number; y: number; text: string; anchor?: 'start' | 'middle'; pill?: boolean }
}

const ZONES = [
  { x: 20, y: 20, w: 220, h: 460, zh: 'AI 端', en: 'AI CLIENT' },
  { x: 260, y: 20, w: 620, h: 460, zh: '主機 · 使用者空間', en: 'HOST · USER SPACE' },
  { x: 900, y: 20, w: 280, h: 460, zh: '可觀測性', en: 'OBSERVABILITY' },
  { x: 20, y: 500, w: 1160, h: 180, zh: 'LINUX 核心', en: 'LINUX KERNEL', kernel: true },
]

const NODES: DiagramNode[] = [
  { id: 'agent', x: 40, y: 70, w: 180, h: 86, title: 'AI Agent', sub: 'Claude · any MCP client' },
  { id: 'mcp', x: 40, y: 300, w: 180, h: 160, title: 'MCP Server', sub: 'TypeScript · stdio', rows: ['translate_error', 'suggest_repair'] },
  { id: 'cli', x: 280, y: 70, w: 290, h: 86, title: 'sentinelbox', sub: 'C · orchestrator', rows: ['profile → cgroup → clone()'] },
  { id: 'monitor', x: 640, y: 70, w: 220, h: 220, title: 'sentinelbox-monitor', sub: 'Rust · security sentinel', rows: ['poll(notify_fd) → RECV', 'policy.lookup(syscall)', 'feedback map → zh/en/hint', 'telemetry thread · 100 ms'] },
  { id: 'sqlite', x: 920, y: 70, w: 240, h: 150, title: 'SQLite · WAL', rows: ['executions', 'syscall_events', 'resource_samples'] },
  { id: 'bridge', x: 920, y: 254, w: 240, h: 66, title: 'Bridge', sub: 'Express · Socket.io' },
  { id: 'dashboard', x: 920, y: 352, w: 240, h: 108, title: 'Dashboard', sub: 'React', rows: ['live CPU / memory', 'events · kill switch'] },
  { id: 'ns', x: 40, y: 540, w: 180, h: 110, title: 'namespaces', rows: ['7 × CLONE_NEW*', 'uid_map · gid_map'], kernel: true },
  { id: 'seccomp', x: 280, y: 540, w: 290, h: 110, title: 'seccomp-BPF', rows: ['ALLOW · ERRNO → decided in-kernel', 'NOTIFY · KILL → listener fd'], kernel: true },
  { id: 'cgroup', x: 640, y: 540, w: 220, h: 110, title: 'cgroup v2', rows: ['memory.max · cpu.max', 'pids.max · memory.events'], kernel: true },
  { id: 'procfs', x: 920, y: 540, w: 240, h: 110, title: 'procfs', rows: ['/proc/stat · /proc/meminfo', 'fallback, no delegation'], kernel: true },
]

const SANDBOX: Box = { x: 280, y: 196, w: 290, h: 264 }
const SANDBOX_PARTS = [
  { x: 298, y: 250, w: 254, h: 56, title: 'target process', sub: 'execvp() · uid 0 ↦ host uid' },
  { x: 298, y: 318, w: 122, h: 124, title: 'OverlayFS root', rows: ['lower: busybox', 'upper: tmpfs', 'pivot_root'] },
  { x: 430, y: 318, w: 122, h: 124, title: 'Hardening', rows: ['no_new_privs', '−13 caps', 'dumpable = 0', 'seccomp filter'] },
]

const EDGES: Edge[] = [
  { id: 'run', from: 'agent', to: 'cli', step: 1, points: [[220, 113], [280, 113]], badge: [250, 113] },
  { id: 'spawn', from: 'cli', to: 'monitor', step: 2, points: [[570, 100], [640, 100]], badge: [605, 100], label: { x: 605, y: 85, text: 'fork+exec', anchor: 'middle' } },
  { id: 'clone', from: 'cli', to: 'sandbox', step: 3, points: [[425, 156], [425, 196]], badge: [425, 176], label: { x: 442, y: 180, text: 'clone()' } },
  { id: 'ns', from: 'sandbox', to: 'ns', step: 3, points: [[280, 430], [252, 430], [252, 595], [220, 595]] },
  { id: 'fd', from: 'sandbox', to: 'monitor', step: 4, points: [[570, 226], [640, 226]], badge: [605, 226], label: { x: 605, y: 211, text: 'notify_fd', anchor: 'middle' } },
  { id: 'syscall', from: 'sandbox', to: 'seccomp', step: 5, points: [[425, 460], [425, 540]], badge: [425, 500], label: { x: 442, y: 504, text: 'syscall' } },
  { id: 'notif', from: 'seccomp', to: 'monitor', step: 6, both: true, points: [[570, 575], [605, 575], [605, 270], [640, 270]], badge: [605, 420], label: { x: 622, y: 424, text: 'USER_NOTIF ⇄ reply' } },
  { id: 'audit', from: 'monitor', to: 'sqlite', step: 7, points: [[860, 125], [920, 125]], badge: [890, 125], label: { x: 890, y: 108, text: 'audit', anchor: 'middle' } },
  { id: 'sample', from: 'monitor', to: 'cgroup', step: 7, points: [[750, 290], [750, 540]], badge: [750, 468], label: { x: 767, y: 472, text: '100 ms' } },
  { id: 'fallback', from: 'monitor', to: 'procfs', step: 7, dashed: true, points: [[830, 290], [830, 515], [1040, 515], [1040, 540]], label: { x: 935, y: 515, text: 'fallback', anchor: 'middle', pill: true } },
  { id: 'feedback', from: 'monitor', to: 'agent', step: 8, points: [[700, 70], [700, 54], [130, 54], [130, 70]], badge: [300, 54], label: { x: 480, y: 54, text: '[SEMANTIC] + HINT', anchor: 'middle', pill: true } },
  { id: 'mcp', from: 'agent', to: 'mcp', step: 8, both: true, points: [[130, 156], [130, 300]], badge: [130, 228], label: { x: 147, y: 232, text: 'MCP · stdio' } },
  { id: 'poll', from: 'sqlite', to: 'bridge', step: 9, points: [[1040, 220], [1040, 254]], badge: [1040, 237], label: { x: 1057, y: 241, text: 'poll' } },
  { id: 'push', from: 'bridge', to: 'dashboard', step: 9, points: [[1040, 320], [1040, 352]], badge: [1040, 336], label: { x: 1057, y: 340, text: 'Socket.io' } },
]

const STEPS = [
  { zh: 'Agent 透過 sentinelbox（scripts/run.sh）執行程式碼，並指定 profile。', en: 'The agent runs code through sentinelbox (scripts/run.sh) with a chosen profile.' },
  { zh: 'Core 建立 socketpair，fork + exec 啟動 Rust monitor，socket 固定在 fd 3。', en: 'The core creates a socketpair and fork-execs the Rust monitor with the socket on fd 3.' },
  { zh: '一次 clone() 建立 7 個 namespace；父行程寫入 uid/gid map，並把 child 放進專屬 cgroup。', en: 'One clone() creates 7 namespaces; the parent writes uid/gid maps and places the child in its own cgroup.' },
  { zh: 'Child 建好 overlay root、降權、安裝 seccomp filter，再以 SCM_RIGHTS 把 notify_fd 交給 monitor。', en: 'The child builds its overlay root, drops privileges, installs the seccomp filter and hands notify_fd to the monitor via SCM_RIGHTS.' },
  { zh: '目標程式的每個 syscall 先經過 seccomp-BPF；ALLOW 與 ERRNO 直接在核心內決定。', en: 'Every syscall from the target hits seccomp-BPF first; ALLOW and ERRNO are decided in-kernel.' },
  { zh: 'NOTIFY / KILL 規則的 syscall 被暫停，monitor 收到通知、查 policy 後回覆（EPERM，KILL 另送 SIGKILL）。', en: 'Syscalls under NOTIFY / KILL rules are parked; the monitor receives them, consults the policy and answers (EPERM, plus SIGKILL for KILL).' },
  { zh: 'Monitor 將事件寫入 SQLite（WAL），每 100 ms 取樣 cgroup v2；未取得 cgroup 授權時改讀 /proc。', en: 'The monitor writes events to SQLite (WAL) and samples cgroup v2 every 100 ms, falling back to /proc without delegation.' },
  { zh: '語意訊息與修正提示回到 Agent；Agent 亦可經 MCP 呼叫 translate_error、suggest_repair。', en: 'Semantic messages and hints return to the agent, which can also call translate_error / suggest_repair over MCP.' },
  { zh: 'Bridge 輪詢資料庫，以 Socket.io 推送給 Dashboard 即時呈現。', en: 'The bridge polls the database and pushes updates to the dashboard over Socket.io.' },
]

const DETAILS: Record<NodeId, { tech: string; path: string; zh: string[]; en: string[] }> = {
  agent: {
    tech: 'Any MCP-capable LLM client', path: 'scripts/run.sh',
    zh: ['以 CLI 執行產生的程式碼，讀取 stderr 中的 [SEMANTIC] / HINT。', '需要時透過 MCP 工具把原始訊號翻譯成可行動的修正方向。'],
    en: ['Runs generated code through the CLI and reads [SEMANTIC] / HINT lines from stderr.', 'Uses the MCP tools to turn raw signals into concrete repair directions.'],
  },
  mcp: {
    tech: 'TypeScript · @modelcontextprotocol/sdk', path: 'mcp-server/src/index.ts',
    zh: ['以 stdio 提供兩個工具：translate_error 與 suggest_repair。', 'SemanticTranslator 對 SIGSYS、SIGKILL、OOM_KILL、EPERM、EACCES 等訊號給出說明。'],
    en: ['Serves two tools over stdio: translate_error and suggest_repair.', 'SemanticTranslator explains SIGSYS, SIGKILL, OOM_KILL, EPERM, EACCES and more.'],
  },
  cli: {
    tech: 'C · libseccomp · libcap', path: 'core/src/main.c · sandbox.c',
    zh: ['解析參數、載入 profile、建立 cgroup 並寫入 memory.max / cpu.max / pids.max。', 'clone() 出沙盒，透過 sync pipe 協調 uid_map；以 wait4() 一次取得結束狀態與 rusage。'],
    en: ['Parses flags, loads the profile, creates the cgroup and writes memory.max / cpu.max / pids.max.', 'clone()s the sandbox, coordinates uid_map over a sync pipe and uses wait4() for exit status plus rusage in one call.'],
  },
  sandbox: {
    tech: 'Linux namespaces · OverlayFS', path: 'core/src/overlayfs.c · capability.c · seccomp.c',
    zh: ['tmpfs 當 upper、busybox 當 lower 的 overlay，pivot_root 後卸載舊根。', '依序：no_new_privs → 移除 13 項 capability → 安裝 seccomp → execvp。'],
    en: ['Overlay with tmpfs upper over a busybox lower; pivot_root then detaches the old root.', 'In order: no_new_privs → drop 13 capabilities → install seccomp → execvp.'],
  },
  monitor: {
    tech: 'Rust · rusqlite · nix', path: 'monitor/src/main.rs',
    zh: ['poll() 等待 notify_fd，sandbox 結束時以 POLLHUP 乾淨退出。', '依 policy 回覆 kernel，並把語意回饋與 errno 符號寫入稽核紀錄。'],
    en: ['poll()s the notify_fd and exits cleanly on POLLHUP once the sandbox is gone.', 'Answers the kernel per policy and records semantic feedback plus the errno symbol.'],
  },
  sqlite: {
    tech: 'SQLite · WAL · synchronous=NORMAL', path: 'monitor/migrations/001_init.sql',
    zh: ['三張表：executions、syscall_events、resource_samples，時間戳皆為毫秒。', 'WAL 讓 monitor 寫入時，bridge 與 MCP 端仍可同時讀取。'],
    en: ['Three tables — executions, syscall_events, resource_samples — with millisecond timestamps.', 'WAL lets the bridge and MCP side read while the monitor writes.'],
  },
  bridge: {
    tech: 'Node.js · Express · Socket.io · better-sqlite3', path: 'server/src/index.js',
    zh: ['以遞增 id 輪詢新事件與取樣，推送 telemetry / security_event。', '提供 kill_sandbox 與本機執行範例程式碼的通道（開發用途）。'],
    en: ['Polls new events and samples by increasing id and emits telemetry / security_event.', 'Exposes kill_sandbox and a local code-execution channel for development.'],
  },
  dashboard: {
    tech: 'React · Vite · Tailwind', path: 'dashboard/src/App.tsx',
    zh: ['即時 CPU / 記憶體圖表、安全事件串流與執行中的沙盒清單。', '可從介面直接終止沙盒。'],
    en: ['Live CPU / memory charts, a security-event stream and the list of running sandboxes.', 'Sandboxes can be killed from the UI.'],
  },
  ns: {
    tech: 'clone(2) · user_namespaces(7)', path: 'core/src/sandbox.c · namespace.c',
    zh: ['CLONE_NEWUSER / PID / NS / NET / UTS / IPC / CGROUP 一次建立。', '沙盒內 uid 0 對應宿主的非特權使用者；先寫 setgroups=deny 才能寫 gid_map。'],
    en: ['CLONE_NEWUSER / PID / NS / NET / UTS / IPC / CGROUP in a single call.', 'uid 0 inside maps to the unprivileged host user; setgroups=deny precedes gid_map.'],
  },
  seccomp: {
    tech: 'seccomp-BPF · SECCOMP_RET_USER_NOTIF', path: 'core/src/seccomp.c',
    zh: ['ALLOW 規則先加入 filter，讓高頻 syscall 更早放行。', 'KILL 也編成 NOTIFY，讓 monitor 先記錄再送 SIGKILL。'],
    en: ['ALLOW rules are added first so frequent syscalls are accepted early.', 'KILL is compiled as NOTIFY so the monitor can log before sending SIGKILL.'],
  },
  cgroup: {
    tech: 'cgroup v2 unified hierarchy', path: 'core/src/cgroup.c · monitor/src/telemetry.rs',
    zh: ['每次執行一個 sentinelbox.<pid> cgroup，結束後 rmdir。', 'monitor 讀 memory.current、cpu.stat；memory.events 的 oom_kill 用來判定 OOM。'],
    en: ['One sentinelbox.<pid> cgroup per run, removed afterwards.', 'The monitor reads memory.current and cpu.stat; oom_kill in memory.events flags OOM.'],
  },
  procfs: {
    tech: 'procfs', path: 'monitor/src/telemetry.rs',
    zh: ['Docker / WSL 等無法委派 cgroup 的環境，改以 /proc/stat、/proc/meminfo 取樣整機負載。', '儀表板仍有資料，但代表整台機器而非單一沙盒。'],
    en: ['Where cgroups cannot be delegated (Docker, some WSL setups) it samples /proc/stat and /proc/meminfo instead.', 'The dashboard keeps working, showing host-wide rather than per-sandbox load.'],
  },
}

const NODE_LABEL: Record<NodeId, { zh: string; en: string }> = {
  agent: { zh: 'AI Agent', en: 'AI Agent' },
  mcp: { zh: 'MCP 伺服器', en: 'MCP server' },
  cli: { zh: 'sentinelbox 核心', en: 'sentinelbox core' },
  sandbox: { zh: '沙盒', en: 'Sandbox' },
  monitor: { zh: 'Rust 監控器', en: 'Rust monitor' },
  sqlite: { zh: 'SQLite 稽核資料庫', en: 'SQLite audit DB' },
  bridge: { zh: '資料橋接', en: 'Bridge' },
  dashboard: { zh: '儀表板', en: 'Dashboard' },
  ns: { zh: 'Namespaces', en: 'Namespaces' },
  seccomp: { zh: 'seccomp-BPF', en: 'seccomp-BPF' },
  cgroup: { zh: 'cgroup v2', en: 'cgroup v2' },
  procfs: { zh: 'procfs 後備', en: 'procfs fallback' },
}

function edgePath(points: [number, number][]) {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')
}

function Diagram({
  activeStep,
  focus,
  onFocusNode,
  onSelectNode,
}: {
  activeStep: number | null
  focus: NodeId | null
  onFocusNode: (id: NodeId | null) => void
  onSelectNode: (id: NodeId) => void
}) {
  const t = useT()
  const lit = useMemo(() => {
    const set = new Set<string>()
    for (const e of EDGES) {
      if (activeStep !== null ? e.step === activeStep : focus !== null && (e.from === focus || e.to === focus)) set.add(e.id)
    }
    return set
  }, [activeStep, focus])
  const anyLit = lit.size > 0
  const nodeLit = (id: NodeId) =>
    focus === id || EDGES.some((e) => lit.has(e.id) && (e.from === id || e.to === id))

  const interactive = (id: NodeId) => ({
    tabIndex: 0,
    role: 'button',
    'aria-label': t(NODE_LABEL[id]),
    onMouseEnter: () => onFocusNode(id),
    onMouseLeave: () => onFocusNode(null),
    onFocus: () => onFocusNode(id),
    onBlur: () => onFocusNode(null),
    onClick: () => onSelectNode(id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelectNode(id)
      }
    },
    className: 'cursor-pointer outline-none',
  })

  return (
    <svg viewBox="0 0 1200 700" className="block h-auto w-full select-none" role="group" aria-label={t({ zh: 'SentinelBox 系統架構圖', en: 'SentinelBox system architecture diagram' })}>
      <defs>
        <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" style={{ fill: 'var(--muted)' }} />
        </marker>
        <marker id="arch-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" style={{ fill: 'var(--brand)' }} />
        </marker>
      </defs>

      {ZONES.map((z) => (
        <g key={z.en}>
          <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={18} style={{ fill: z.kernel ? 'var(--kernel-soft)' : 'var(--surface-2)', stroke: 'var(--line)' }} />
          <text x={z.x + 16} y={z.y + 22} className="font-mono" style={{ fill: z.kernel ? 'var(--kernel)' : 'var(--muted)', fontSize: 11, letterSpacing: '0.12em', fontWeight: 600 }}>
            {t(z)}
          </text>
        </g>
      ))}

      {/* Sandbox boundary with its internal parts. */}
      <g {...interactive('sandbox')}>
        <rect
          x={SANDBOX.x} y={SANDBOX.y} width={SANDBOX.w} height={SANDBOX.h} rx={14}
          style={{ fill: 'var(--brand-soft)', stroke: nodeLit('sandbox') ? 'var(--brand)' : 'var(--brand-line)', strokeWidth: nodeLit('sandbox') ? 2 : 1.5, strokeDasharray: '7 5' }}
        />
        <text x={SANDBOX.x + 16} y={SANDBOX.y + 22} className="font-mono" style={{ fill: 'var(--brand-ink)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em' }}>SANDBOX</text>
        <text x={SANDBOX.x + 16} y={SANDBOX.y + 40} className="font-mono" style={{ fill: 'var(--muted)', fontSize: 10 }}>user · pid · mnt · net · uts · ipc · cgroup</text>
        {SANDBOX_PARTS.map((p) => (
          <g key={p.title}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={10} style={{ fill: 'var(--surface)', stroke: 'var(--line-strong)' }} />
            <text x={p.x + 12} y={p.y + 22} style={{ fill: 'var(--fg)', fontSize: 12.5, fontWeight: 600 }}>{p.title}</text>
            {p.sub && <text x={p.x + 12} y={p.y + 40} className="font-mono" style={{ fill: 'var(--muted)', fontSize: 10 }}>{p.sub}</text>}
            {p.rows?.map((r, i) => (
              <text key={r} x={p.x + 12} y={p.y + 44 + i * 18} className="font-mono" style={{ fill: 'var(--fg-2)', fontSize: 10 }}>{r}</text>
            ))}
          </g>
        ))}
      </g>

      {EDGES.map((e) => {
        const on = lit.has(e.id)
        return (
          <path
            key={e.id}
            d={edgePath(e.points)}
            fill="none"
            markerEnd={`url(#${on ? 'arch-arrow-lit' : 'arch-arrow'})`}
            markerStart={e.both ? `url(#${on ? 'arch-arrow-lit' : 'arch-arrow'})` : undefined}
            className={on ? 'edge-flow' : undefined}
            style={{
              stroke: on ? 'var(--brand)' : 'var(--muted)',
              strokeWidth: on ? 2.2 : 1.4,
              strokeDasharray: on ? undefined : e.dashed ? '5 5' : undefined,
              opacity: anyLit && !on ? 0.28 : 0.9,
              transition: 'opacity 200ms',
            }}
          />
        )
      })}

      {NODES.map((n) => {
        const on = nodeLit(n.id)
        return (
          <g key={n.id} {...interactive(n.id)} style={{ opacity: anyLit && !on ? 0.55 : 1, transition: 'opacity 200ms' }}>
            <rect
              x={n.x} y={n.y} width={n.w} height={n.h} rx={12}
              style={{ fill: 'var(--surface)', stroke: on ? 'var(--brand)' : n.kernel ? 'color-mix(in oklab, var(--kernel) 45%, transparent)' : 'var(--line-strong)', strokeWidth: on ? 2 : 1.2 }}
            />
            <text x={n.x + 14} y={n.y + 26} style={{ fill: 'var(--fg)', fontSize: 14, fontWeight: 650 }}>{n.title}</text>
            {n.sub && <text x={n.x + 14} y={n.y + 44} className="font-mono" style={{ fill: 'var(--muted)', fontSize: 10.5 }}>{n.sub}</text>}
            {n.id === 'monitor' || n.id === 'sqlite' || n.id === 'mcp'
              ? n.rows?.map((r, i) => {
                  const top = n.y + (n.sub ? 60 : 40) + i * 36
                  return (
                    <g key={r}>
                      <rect x={n.x + 12} y={top} width={n.w - 24} height={26} rx={6} style={{ fill: 'var(--surface-2)', stroke: 'var(--line)' }} />
                      <text x={n.x + 22} y={top + 17} className="font-mono" style={{ fill: 'var(--fg-2)', fontSize: 10.5 }}>{r}</text>
                    </g>
                  )
                })
              : n.rows?.map((r, i) => (
                  <text key={r} x={n.x + 14} y={n.y + (n.sub ? 66 : 50) + i * 20} className="font-mono" style={{ fill: 'var(--fg-2)', fontSize: 10.5 }}>{r}</text>
                ))}
          </g>
        )
      })}

      {EDGES.map((e) => {
        const on = lit.has(e.id)
        return (
          <g key={`${e.id}-meta`} style={{ opacity: anyLit && !on ? 0.3 : 1, transition: 'opacity 200ms' }} pointerEvents="none">
            {e.label && e.label.pill && (
              <rect
                x={e.label.x - e.label.text.length * 3.4 - 8} y={e.label.y - 10} width={e.label.text.length * 6.8 + 16} height={20} rx={10}
                style={{ fill: 'var(--surface)', stroke: on ? 'var(--brand)' : 'var(--line-strong)' }}
              />
            )}
            {e.label && (
              <text x={e.label.x} y={e.label.y + (e.label.pill ? 4 : 0)} textAnchor={e.label.anchor ?? 'start'} className="font-mono" style={{ fill: on ? 'var(--brand-ink)' : 'var(--muted)', fontSize: 10.5, fontWeight: 500 }}>
                {e.label.text}
              </text>
            )}
            {e.badge && (
              <g>
                <circle cx={e.badge[0]} cy={e.badge[1]} r={10} style={{ fill: on ? 'var(--brand)' : 'var(--surface)', stroke: on ? 'var(--brand)' : 'var(--line-strong)' }} />
                <text x={e.badge[0]} y={e.badge[1] + 3.6} textAnchor="middle" className="font-mono" style={{ fill: on ? '#fff' : 'var(--fg-2)', fontSize: 10.5, fontWeight: 700 }}>{e.step}</text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function Architecture() {
  const t = useT()
  const [activeStep, setActiveStep] = useState<number | null>(null)
  const [hover, setHover] = useState<NodeId | null>(null)
  const [selected, setSelected] = useState<NodeId>('monitor')
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!playing) return
    const id = window.setTimeout(() => {
      if (activeStep === null || activeStep >= STEPS.length) {
        setPlaying(false)
        setActiveStep(null)
      } else {
        setActiveStep(activeStep + 1)
      }
    }, 1700)
    return () => clearTimeout(id)
  }, [playing, activeStep])

  const focusNode = (id: NodeId | null) => {
    setHover(id)
    if (id) {
      setPlaying(false)
      setActiveStep(null)
    }
  }
  const detailId = hover ?? selected
  const detail = DETAILS[detailId]

  return (
    <Section
      id="architecture"
      eyebrow={t({ zh: '系統架構', en: 'Architecture' })}
      title={t({ zh: '四個獨立行程，各自用最合適的語言守一層。', en: 'Four processes, each guarding one layer in the language that suits it.' })}
      lead={t({
        zh: 'C 負責貼近核心的隔離、Rust 負責安全決策與稽核、TypeScript 把結果交給 AI，Web 端負責可觀測性。滑過或點選元件查看職責，或依序播放一次完整的執行流程。',
        en: 'C handles kernel-facing isolation, Rust makes security decisions and keeps the audit trail, TypeScript hands results to the AI, and the web tier provides observability. Hover or select a component, or play through one complete run.',
      })}
    >
      <div className="rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow)] sm:p-4">
        <div className="flex flex-wrap items-center gap-3 px-1 pb-3">
          <button
            type="button"
            onClick={() => {
              if (playing) setPlaying(false)
              else {
                setActiveStep(1)
                setPlaying(true)
              }
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
            {playing ? t({ zh: '暫停', en: 'Pause' }) : t({ zh: '播放執行流程', en: 'Play a run' })}
          </button>
          <div className="flex items-center gap-4 font-mono text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-px w-5 bg-[var(--muted)]" />{t({ zh: '呼叫 / 資料流', en: 'call / data flow' })}</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-[var(--muted)]" />{t({ zh: '後備路徑', en: 'fallback path' })}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border border-dashed border-[var(--brand-line)] bg-brand-soft" />{t({ zh: '隔離邊界', en: 'isolation boundary' })}</span>
          </div>
          <p className="ml-auto font-mono text-[11px] text-muted lg:hidden">{t({ zh: '← 可左右滑動 →', en: '← scroll sideways →' })}</p>
        </div>
        <div className="overflow-x-auto rounded-xl">
          <div className="min-w-[920px]">
            <Diagram activeStep={activeStep} focus={hover} onFocusNode={focusNode} onSelectNode={(id) => setSelected(id)} />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <ol className="space-y-1.5" aria-label={t({ zh: '執行流程', en: 'Run sequence' })}>
          {STEPS.map((s, i) => {
            const n = i + 1
            const on = activeStep === n
            return (
              <li key={n}>
                <button
                  type="button"
                  onMouseEnter={() => { setPlaying(false); setActiveStep(n) }}
                  onMouseLeave={() => !playing && setActiveStep(null)}
                  onFocus={() => { setPlaying(false); setActiveStep(n) }}
                  onBlur={() => !playing && setActiveStep(null)}
                  onClick={() => { setPlaying(false); setActiveStep(on ? null : n) }}
                  aria-pressed={on}
                  className={`flex w-full gap-3 rounded-xl border px-3 py-2.5 text-left text-sm leading-relaxed transition ${
                    on ? 'border-[var(--brand-line)] bg-brand-soft text-fg' : 'border-transparent text-fg-2 hover:bg-surface-2'
                  }`}
                >
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold ${on ? 'bg-brand text-white' : 'border border-line-strong text-muted'}`}>{n}</span>
                  <span>{t(s)}</span>
                </button>
              </li>
            )
          })}
        </ol>

        <aside aria-live="polite" className="h-fit rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)] lg:sticky lg:top-24">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-ink">{t({ zh: '元件', en: 'Component' })}</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">{t(NODE_LABEL[detailId])}</h3>
          <p className="mt-1 font-mono text-xs text-muted">{detail.tech}</p>
          <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-fg-2">
            {t({ zh: detail.zh, en: detail.en }).map((line) => (
              <li key={line} className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-muted">{detail.path}</p>
        </aside>
      </div>
    </Section>
  )
}
