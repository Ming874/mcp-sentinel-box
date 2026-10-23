import { Boxes, Database, FolderLock, Gauge, KeyRound, ListFilter } from 'lucide-react'
import { ActionBadge, Section } from './ui'
import { useT } from '../prefs'
import { countActions, formatBytes, formatCpu, profiles } from '../data/model'

const LAYERS = [
  {
    icon: Boxes,
    title: { zh: 'Namespaces', en: 'Namespaces' },
    path: 'core/src/sandbox.c',
    items: {
      zh: ['一次 clone() 建立 user、pid、mount、net、uts、ipc、cgroup', '沙盒內 uid 0 = 宿主非特權使用者（rootless）', '先寫 setgroups=deny 再寫 gid_map'],
      en: ['user, pid, mount, net, uts, ipc and cgroup from one clone()', 'uid 0 inside is an unprivileged host user (rootless)', 'setgroups=deny is written before gid_map'],
    },
  },
  {
    icon: FolderLock,
    title: { zh: '檔案系統', en: 'Filesystem' },
    path: 'core/src/overlayfs.c',
    items: {
      zh: ['OverlayFS：busybox 唯讀 lower + tmpfs upper，寫入隨沙盒消失', 'pivot_root + MNT_DETACH 取代 chroot，杜絕逃逸', '根掛載設為 private，掛載動作不外洩到宿主'],
      en: ['OverlayFS: read-only busybox lower + tmpfs upper; writes vanish with the sandbox', 'pivot_root + MNT_DETACH instead of chroot, so there is no way back out', 'Root propagation set to private so mounts never leak to the host'],
    },
  },
  {
    icon: KeyRound,
    title: { zh: '權限', en: 'Privileges' },
    path: 'core/src/capability.c',
    items: {
      zh: ['PR_SET_NO_NEW_PRIVS：setuid 程式也拿不到額外權限', '移除 13 項高風險 capability，包含 bounding set', 'PR_SET_DUMPABLE = 0，避免 core dump 洩漏記憶體'],
      en: ['PR_SET_NO_NEW_PRIVS: setuid binaries cannot gain privileges', '13 dangerous capabilities dropped, including the bounding set', 'PR_SET_DUMPABLE = 0 so no core dump can leak memory'],
    },
  },
  {
    icon: ListFilter,
    title: { zh: '系統呼叫', en: 'Syscalls' },
    path: 'core/src/seccomp.c',
    items: {
      zh: ['seccomp-BPF + SECCOMP_RET_USER_NOTIF，不用 ptrace', 'ALLOW 規則優先加入，讓高頻 syscall 早點放行', 'KILL 編成 NOTIFY：先記錄、再終止'],
      en: ['seccomp-BPF with SECCOMP_RET_USER_NOTIF instead of ptrace', 'ALLOW rules are added first so hot syscalls pass early', 'KILL compiles to NOTIFY: record first, then terminate'],
    },
  },
  {
    icon: Gauge,
    title: { zh: '資源', en: 'Resources' },
    path: 'core/src/cgroup.c',
    items: {
      zh: ['cgroup v2：memory.max、cpu.max、pids.max（擋 fork bomb）', '每次執行獨立 cgroup，結束即移除', 'memory.events 的 oom_kill 轉成 OOM 語意事件'],
      en: ['cgroup v2: memory.max, cpu.max, pids.max (stops fork bombs)', 'A dedicated cgroup per run, removed when it ends', 'oom_kill in memory.events becomes a semantic OOM event'],
    },
  },
  {
    icon: Database,
    title: { zh: '稽核', en: 'Audit' },
    path: 'monitor/src/db.rs',
    items: {
      zh: ['每一筆攔截都寫入 SQLite，含 errno 符號與語意文字', 'WAL + synchronous=NORMAL + busy_timeout 5 s', '執行、事件、取樣三張表，皆以毫秒計時'],
      en: ['Every interception is stored in SQLite with the errno symbol and semantic text', 'WAL + synchronous=NORMAL + 5 s busy_timeout', 'Executions, events and samples, all timestamped in ms'],
    },
  },
]

const PROFILE_COPY: Record<string, { zh: string; en: string }> = {
  strict: { zh: '預設。禁止建立網路連線，阻擋核心安全相關 syscall，所有違規都通報 monitor。', en: 'Default. Blocks network calls and kernel-sensitive syscalls; every violation is reported to the monitor.' },
  datascience: { zh: '放寬記憶體與 CPU；攔截 connect / bind，允許本地 socket 通訊。', en: 'More memory and CPU; connect / bind are intercepted while local sockets stay usable.' },
  web: { zh: '給 Web Agent：policy 允許出站 socket，攔截 bind / listen / accept 等對內服務。', en: 'For web agents: outbound sockets allowed by policy; inbound bind / listen / accept are intercepted.' },
}

export function Defense() {
  const t = useT()
  return (
    <Section
      id="defense"
      eyebrow={t({ zh: '縱深防禦', en: 'Defense in depth' })}
      title={t({ zh: '六層機制疊在一起，任何一層失守都還有下一層。', en: 'Six stacked layers, so no single failure opens the box.' })}
      lead={t({
        zh: '隔離不靠單一技術。即使某個 syscall 規則漏列，沙盒仍在獨立的 namespace、唯讀的根目錄、被剝除的 capability 與 cgroup 上限之內。',
        en: 'Isolation never relies on one mechanism. Even if a syscall rule is missing, the process is still inside its own namespaces, a read-only root, stripped capabilities and cgroup limits.',
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LAYERS.map((l, i) => (
          <article key={l.path} className="group rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)] transition hover:border-[var(--brand-line)] sm:p-6">
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-ink">
                <l.icon size={20} />
              </span>
              <span className="font-mono text-xs text-muted">L{i + 1}</span>
            </div>
            <h3 className="mt-4 text-lg font-semibold tracking-tight">{t(l.title)}</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-fg-2">
              {t(l.items).map((it) => (
                <li key={it} className="flex gap-2.5">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--muted)]" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 font-mono text-[11px] text-muted">{l.path}</p>
          </article>
        ))}
      </div>

      <div id="profiles" className="mt-16 scroll-mt-24">
        <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">{t({ zh: '三個內建 profile', en: 'Three built-in profiles' })}</h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-2 sm:text-base">
          {t({
            zh: 'Profile 是 C 核心與 Rust monitor 共用的同一份 JSON：前者據以安裝 seccomp filter 與 cgroup 上限，後者據以做出決策。',
            en: 'A profile is one JSON file shared by the C core and the Rust monitor: the core installs the seccomp filter and cgroup limits from it, the monitor makes decisions from it.',
          })}
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {profiles.map((p) => {
            const c = countActions(p)
            return (
              <article key={p.name} className={`rounded-2xl border bg-surface p-5 shadow-[var(--shadow)] ${p.name === 'strict' ? 'border-[var(--brand-line)]' : 'border-line'}`}>
                <div className="flex items-center justify-between">
                  <h4 className="font-mono text-lg font-semibold">{p.name}</h4>
                  {p.name === 'strict' && <span className="rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[11px] text-brand-ink">default</span>}
                </div>
                <p className="mt-2 min-h-[3.5rem] text-sm leading-relaxed text-fg-2">{t(PROFILE_COPY[p.name] ?? { zh: p.description, en: p.description })}</p>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-y border-line py-4 text-center">
                  <div>
                    <dt className="text-[11px] text-muted">memory.max</dt>
                    <dd className="mt-1 font-mono text-sm font-semibold">{formatBytes(p.resources.mem_limit_bytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">cpu.max</dt>
                    <dd className="mt-1 font-mono text-sm font-semibold">{formatCpu(p)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">pids.max</dt>
                    <dd className="mt-1 font-mono text-sm font-semibold">{p.resources.pids_max}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(['NOTIFY', 'KILL', 'ERRNO'] as const).map((a) =>
                    c[a] ? (
                      <span key={a} className="inline-flex items-center gap-1.5 text-xs text-fg-2">
                        <ActionBadge action={a} /> × {c[a]}
                      </span>
                    ) : null,
                  )}
                </div>
                <p className="mt-3 font-mono text-[11px] text-muted">profiles/{p.name}.json · default_action: {p.default_action}</p>
              </article>
            )
          })}
        </div>
      </div>
    </Section>
  )
}
