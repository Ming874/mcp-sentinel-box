import { Section } from './ui'
import { useT } from '../prefs'

// Sequence of one sandbox run, transcribed from core/src/main.c, core/src/sandbox.c
// and monitor/src/main.rs.

type Lane = 'P' | 'C' | 'M' | 'K'
type Row = { from: Lane; to: Lane; label: string; zh: string; en: string }

const LANES: { id: Lane; title: string; sub: { zh: string; en: string }; x: number }[] = [
  { id: 'P', title: 'sentinelbox', sub: { zh: '父行程 · C', en: 'parent · C' }, x: 250 },
  { id: 'C', title: 'sandbox child', sub: { zh: '沙盒子行程', en: 'in new namespaces' }, x: 470 },
  { id: 'M', title: 'monitor', sub: { zh: 'Rust 監控器', en: 'Rust sentinel' }, x: 690 },
  { id: 'K', title: 'Linux kernel', sub: { zh: '核心', en: 'kernel' }, x: 910 },
]
const laneX = Object.fromEntries(LANES.map((l) => [l.id, l.x])) as Record<Lane, number>

const PHASES = [
  { from: 0, to: 4, zh: '準備', en: 'Setup' },
  { from: 5, to: 10, zh: '隔離', en: 'Isolate' },
  { from: 11, to: 13, zh: '監督', en: 'Supervise' },
  { from: 14, to: 16, zh: '收尾', en: 'Teardown' },
]

const ROWS: Row[] = [
  { from: 'P', to: 'P', label: 'load profile · create cgroup · write limits', zh: '載入 profile，建立 sentinelbox.<pid> cgroup 並寫入 memory.max、cpu.max、pids.max。', en: 'Load the profile, create the sentinelbox.<pid> cgroup and write memory.max, cpu.max and pids.max.' },
  { from: 'P', to: 'M', label: 'socketpair · fork + exec (fd 3)', zh: '建立 socketpair，fork + exec 啟動 monitor；socket dup2 到 fd 3，cgroup 路徑與 profile 以環境變數傳入。', en: 'Create a socketpair and fork-exec the monitor; the socket is dup2’d to fd 3, cgroup path and profile go in env vars.' },
  { from: 'P', to: 'C', label: 'clone(7 × CLONE_NEW*)', zh: 'clone() 一次建立 user、pid、mount、net、uts、ipc、cgroup 七個 namespace。', en: 'clone() creates the user, pid, mount, net, uts, ipc and cgroup namespaces in one call.' },
  { from: 'P', to: 'K', label: 'setgroups=deny · uid_map · gid_map · cgroup.procs', zh: '父行程寫 setgroups=deny、uid_map、gid_map，並把 child 寫入 cgroup.procs。', en: 'The parent writes setgroups=deny, uid_map and gid_map, then adds the child to cgroup.procs.' },
  { from: 'P', to: 'C', label: 'sync pipe: host PID ⇒ go', zh: '透過 sync pipe 傳出 child 的宿主 PID，解除 child 的等待。', en: 'Send the child’s host PID over the sync pipe, releasing the child.' },
  { from: 'C', to: 'C', label: 'setresuid(0) · PR_SET_DUMPABLE = 0', zh: '成為沙盒內 uid 0（對應宿主非特權使用者），並禁止 core dump。', en: 'Become uid 0 inside (an unprivileged user on the host) and disable core dumps.' },
  { from: 'C', to: 'K', label: 'tmpfs + overlay → pivot_root · /proc', zh: '掛 tmpfs 與 overlay、pivot_root 後卸載舊根，再掛 /proc（巢狀容器時改用 rbind）。', en: 'Mount tmpfs and overlay, pivot_root and detach the old root, then mount /proc (rbind when nested).' },
  { from: 'C', to: 'C', label: 'hostname · no_new_privs · drop 13 caps', zh: '設定 hostname、PR_SET_NO_NEW_PRIVS，並從 effective / permitted / inheritable / bounding 移除 13 項 capability。', en: 'Set the hostname and PR_SET_NO_NEW_PRIVS, then drop 13 capabilities from effective, permitted, inheritable and bounding sets.' },
  { from: 'C', to: 'K', label: 'seccomp_load(filter) → notify_fd', zh: '依 profile 安裝 seccomp filter，取得 USER_NOTIF listener fd。', en: 'Install the profile’s seccomp filter and obtain the USER_NOTIF listener fd.' },
  { from: 'C', to: 'M', label: 'SCM_RIGHTS: notify_fd + "PID|CMD"', zh: '以 sendmsg(SCM_RIGHTS) 把 notify_fd 與「PID:<pid>|CMD:<argv>」交給 monitor。', en: 'Pass notify_fd plus "PID:<pid>|CMD:<argv>" to the monitor with sendmsg(SCM_RIGHTS).' },
  { from: 'C', to: 'C', label: 'execvp(target)', zh: 'execvp() 執行目標程式，之後的 syscall 都受 filter 管控。', en: 'execvp() the target; every later syscall goes through the filter.' },
  { from: 'K', to: 'M', label: 'USER_NOTIF: NOTIFY / KILL syscall', zh: '命中 NOTIFY / KILL 規則的 syscall 被暫停，通知送到 monitor。', en: 'A syscall matching a NOTIFY / KILL rule is parked and delivered to the monitor.' },
  { from: 'M', to: 'K', label: 'NOTIF_SEND: CONTINUE | −EPERM (+SIGKILL)', zh: '查 policy 後回覆：放行（CONTINUE）或 −EPERM；KILL 規則再送 SIGKILL，並寫入稽核紀錄。', en: 'Reply per policy — CONTINUE or −EPERM, plus SIGKILL for KILL rules — and write the audit record.' },
  { from: 'M', to: 'M', label: 'telemetry → SQLite every 100 ms', zh: 'telemetry 執行緒每 100 ms 讀 memory.current 與 cpu.stat 寫入 resource_samples。', en: 'The telemetry thread reads memory.current and cpu.stat every 100 ms into resource_samples.' },
  { from: 'K', to: 'P', label: 'child exits → wait4(status, rusage)', zh: 'child 結束，wait4() 一次取得結束狀態與 rusage（作為 cgroup 讀不到時的後備數據）。', en: 'The child exits; wait4() returns status and rusage together (the fallback when cgroup stats are unavailable).' },
  { from: 'K', to: 'M', label: 'POLLHUP → record end · check oom_kill', zh: 'notify_fd 回報 POLLHUP，monitor 記錄結束，並從 memory.events 判斷是否 OOM。', en: 'notify_fd reports POLLHUP; the monitor records the end and checks memory.events for an OOM kill.' },
  { from: 'P', to: 'P', label: 'waitpid(monitor) · summary · rmdir cgroup', zh: '等待 monitor 結束、輸出資源摘要，最後刪除 cgroup。', en: 'Wait for the monitor, print the resource summary and remove the cgroup.' },
]

const TOP = 112
const ROW_H = 38
const HEIGHT = TOP + ROWS.length * ROW_H + 24

function SequenceSvg() {
  const t = useT()
  const loopTop = TOP + 11 * ROW_H - 36
  const loopBottom = TOP + 14 * ROW_H - 14
  return (
    <svg viewBox={`0 0 1020 ${HEIGHT}`} className="block h-auto w-full" role="img" aria-label={t({ zh: '沙盒生命週期時序圖', en: 'Sandbox lifecycle sequence diagram' })}>
      <defs>
        <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" style={{ fill: 'var(--fg-2)' }} />
        </marker>
      </defs>

      {PHASES.map((p, i) => {
        const y1 = TOP + p.from * ROW_H - 20
        const y2 = TOP + p.to * ROW_H + 18
        return (
          <g key={p.en}>
            <rect x={20} y={y1} width={980} height={y2 - y1} rx={10} style={{ fill: i % 2 ? 'transparent' : 'var(--surface-2)' }} />
            <text x={36} y={y1 + 22} className="font-mono" style={{ fill: 'var(--brand-ink)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}>
              {String(i + 1).padStart(2, '0')}
            </text>
            <text x={36} y={y1 + 40} style={{ fill: 'var(--fg)', fontSize: 13, fontWeight: 600 }}>{t(p)}</text>
          </g>
        )
      })}

      {LANES.map((l) => (
        <g key={l.id}>
          <line x1={l.x} y1={78} x2={l.x} y2={HEIGHT - 10} style={{ stroke: 'var(--line-strong)', strokeDasharray: '3 5' }} />
          <rect x={l.x - 86} y={16} width={172} height={56} rx={12} style={{ fill: 'var(--surface)', stroke: l.id === 'K' ? 'color-mix(in oklab, var(--kernel) 50%, transparent)' : 'var(--line-strong)' }} />
          <text x={l.x} y={40} textAnchor="middle" className="font-mono" style={{ fill: 'var(--fg)', fontSize: 13, fontWeight: 600 }}>{l.title}</text>
          <text x={l.x} y={58} textAnchor="middle" style={{ fill: 'var(--muted)', fontSize: 11 }}>{t(l.sub)}</text>
        </g>
      ))}

      <rect x={laneX.M - 90} y={loopTop} width={laneX.K - laneX.M + 180} height={loopBottom - loopTop} rx={8} style={{ fill: 'none', stroke: 'var(--brand-line)', strokeDasharray: '6 4' }} />
      <rect x={laneX.M - 90} y={loopTop} width={168} height={18} rx={4} style={{ fill: 'var(--brand)' }} />
      <text x={laneX.M - 82} y={loopTop + 13} className="font-mono" style={{ fill: '#fff', fontSize: 10, fontWeight: 600 }}>loop · while sandbox runs</text>

      {ROWS.map((r, i) => {
        const y = TOP + i * ROW_H
        const x1 = laneX[r.from]
        const x2 = laneX[r.to]
        if (r.from === r.to) {
          return (
            <g key={i}>
              <title>{t(r)}</title>
              <path d={`M${x1} ${y - 7} h22 v14 h-20`} fill="none" markerEnd="url(#seq-arrow)" style={{ stroke: 'var(--fg-2)', strokeWidth: 1.3 }} />
              <rect x={x1 + 28} y={y - 9} width={r.label.length * 6.1 + 12} height={18} rx={4} style={{ fill: 'var(--surface)', stroke: 'var(--line)' }} />
              <text x={x1 + 34} y={y + 4} style={{ fill: 'var(--fg-2)', fontSize: 11.5 }}>{r.label}</text>
            </g>
          )
        }
        const mid = (x1 + x2) / 2
        const width = r.label.length * 6.1 + 16
        return (
          <g key={i}>
            <title>{t(r)}</title>
            <line x1={x1} y1={y + 6} x2={x2 + (x2 > x1 ? -2 : 2)} y2={y + 6} markerEnd="url(#seq-arrow)" style={{ stroke: 'var(--fg-2)', strokeWidth: 1.3 }} />
            <rect x={mid - width / 2} y={y - 13} width={width} height={17} rx={4} style={{ fill: 'var(--surface)', stroke: 'var(--line)' }} />
            <text x={mid} y={y - 1} textAnchor="middle" style={{ fill: 'var(--fg)', fontSize: 11.5 }}>{r.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

const LANE_NAME: Record<Lane, { zh: string; en: string }> = {
  P: { zh: '父行程', en: 'Parent' },
  C: { zh: '沙盒', en: 'Child' },
  M: { zh: 'Monitor', en: 'Monitor' },
  K: { zh: '核心', en: 'Kernel' },
}

function Timeline() {
  const t = useT()
  return (
    <ol className="space-y-8">
      {PHASES.map((p, pi) => (
        <li key={p.en}>
          <p className="font-mono text-xs font-semibold tracking-[0.14em] text-brand-ink">
            {String(pi + 1).padStart(2, '0')} · {t(p).toUpperCase()}
          </p>
          <ol className="mt-3 space-y-3 border-l border-line-strong pl-5">
            {ROWS.slice(p.from, p.to + 1).map((r, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-brand" />
                <p className="font-mono text-[11px] text-muted">
                  {t(LANE_NAME[r.from])}
                  {r.from !== r.to && <> → {t(LANE_NAME[r.to])}</>}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-fg-2">{t(r)}</p>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}

export function Lifecycle() {
  const t = useT()
  return (
    <Section
      id="lifecycle"
      eyebrow={t({ zh: '生命週期', en: 'Lifecycle' })}
      title={t({ zh: '一次執行，從 clone() 到 rmdir。', en: 'One run, from clone() to rmdir.' })}
      lead={t({
        zh: '順序本身就是安全設計：先寫 uid_map 才讓 child 繼續、先降權再安裝 seccomp、最後才 execvp。每一步都對應到原始碼中的實際呼叫。',
        en: 'The order is part of the security design: uid_map is written before the child continues, privileges drop before seccomp is installed, and execvp comes last. Each step maps to an actual call in the source.',
      })}
    >
      <div className="hidden rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow)] md:block">
        <SequenceSvg />
      </div>
      <div className="md:hidden">
        <Timeline />
      </div>
    </Section>
  )
}
