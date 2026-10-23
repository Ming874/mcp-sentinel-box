import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, Cpu, ShieldCheck, Skull, Undo2 } from 'lucide-react'
import { ActionBadge, Section } from './ui'
import { useT } from '../prefs'
import { getProfile, lookup, profiles, semantic, type Action } from '../data/model'

// Interactive version of the decision path: seccomp filter (core/src/seccomp.c)
// → USER_NOTIF → policy lookup (monitor/src/policy.rs) → reply (monitor/src/main.rs).

const SYSCALLS: { name: string; zh: string; en: string; args?: Record<number, string> }[] = [
  { name: 'socket', zh: '建立網路 socket', en: 'open a network socket', args: { 0: '2' } },
  { name: 'connect', zh: '對外連線', en: 'connect outward' },
  { name: 'bind', zh: '監聽連接埠', en: 'bind a listening port' },
  { name: 'ptrace', zh: '附加除錯器', en: 'attach a debugger' },
  { name: 'mount', zh: '掛載檔案系統', en: 'mount a filesystem' },
  { name: 'unshare', zh: '建立新 namespace', en: 'create a new namespace' },
  { name: 'bpf', zh: '載入 BPF 程式', en: 'load a BPF program' },
  { name: 'userfaultfd', zh: 'userfaultfd', en: 'userfaultfd' },
  { name: 'chroot', zh: '變更根目錄', en: 'change root' },
  { name: 'mknod', zh: '建立 device node', en: 'create a device node' },
  { name: 'openat', zh: '開檔', en: 'open a file' },
  { name: 'sendmsg', zh: '在既有 socket 上傳資料', en: 'send on an existing socket' },
]

type Outcome = {
  where: 'kernel' | 'monitor'
  process: { zh: string; en: string }
  logged: boolean
  feedback: boolean
}

function outcome(action: Action, errno: number): Outcome {
  switch (action) {
    case 'ALLOW':
      return { where: 'kernel', process: { zh: '系統呼叫正常執行', en: 'the syscall runs normally' }, logged: false, feedback: false }
    case 'ERRNO':
      return { where: 'kernel', process: { zh: `立即回傳 −${errno === 1 ? 'EPERM' : errno}`, en: `returns −${errno === 1 ? 'EPERM' : errno} immediately` }, logged: false, feedback: false }
    case 'NOTIFY':
      return { where: 'monitor', process: { zh: '收到 −EPERM，程式可自行處理錯誤', en: 'gets −EPERM and can handle the error' }, logged: true, feedback: true }
    case 'KILL':
      return { where: 'monitor', process: { zh: '先收到 −EPERM，接著被 SIGKILL 終止', en: 'gets −EPERM, then is terminated with SIGKILL' }, logged: true, feedback: true }
  }
}

function Stage({ active, icon, title, children }: { active: boolean; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 transition ${active ? 'border-[var(--brand-line)] bg-brand-soft' : 'border-line bg-surface-2 opacity-60'}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className={active ? 'text-brand-ink' : 'text-muted'}>{icon}</span>
        {title}
      </div>
      <div className="mt-1.5 text-sm leading-relaxed text-fg-2">{children}</div>
    </div>
  )
}

export function Decisions() {
  const t = useT()
  const [profileName, setProfileName] = useState('strict')
  const [syscall, setSyscall] = useState('socket')
  const profile = getProfile(profileName)
  const sc = SYSCALLS.find((s) => s.name === syscall) ?? SYSCALLS[0]
  const rule = lookup(profile, syscall)
  const out = outcome(rule.action, rule.errno)
  const fb = useMemo(() => semantic(profile, syscall, sc.args), [profile, syscall, sc.args])
  const viaListener = rule.action === 'NOTIFY' || rule.action === 'KILL'

  const note = (() => {
    if (syscall === 'sendmsg') {
      return t({
        zh: '刻意不攔 sendmsg：child 安裝 seccomp 之後，正是用 sendmsg(SCM_RIGHTS) 把 notify_fd 交給 monitor；若它也走 NOTIFY，會被自己的 filter 卡住而死結。封鎖 socket() / connect() 已足以切斷網路。',
        en: 'sendmsg is deliberately not filtered: after installing seccomp the child uses sendmsg(SCM_RIGHTS) to hand notify_fd to the monitor, so a NOTIFY rule would deadlock it on its own filter. Blocking socket() / connect() already cuts the network.',
      })
    }
    if ((syscall === 'socket' || syscall === 'connect') && rule.action === 'ALLOW') {
      return t({
        zh: '此 profile 的 policy 允許網路呼叫，但沙盒一律在新的 network namespace 中啟動，目前沒有建立對外介面（veth），實際上仍無法連到外部——這列在 roadmap。',
        en: 'This profile’s policy allows the call, but the sandbox always starts in a fresh network namespace with no outbound interface (veth) yet, so it still cannot reach the outside — this is on the roadmap.',
      })
    }
    if (rule.action === 'KILL') {
      return t({
        zh: 'C 核心把 KILL 規則編成 SCMP_ACT_NOTIFY 而不是 SCMP_ACT_KILL，好讓 monitor 先寫下稽核紀錄與語意回饋，再送出 SIGKILL。',
        en: 'The C core compiles KILL rules as SCMP_ACT_NOTIFY rather than SCMP_ACT_KILL so the monitor can write the audit record and semantic feedback before sending SIGKILL.',
      })
    }
    if (rule.action === 'ERRNO') {
      return t({
        zh: 'ERRNO 由核心直接回覆，不經過 monitor：成本最低，但也不會留下稽核紀錄或語意回饋。',
        en: 'ERRNO is answered by the kernel without involving the monitor: cheapest, but it leaves no audit record or semantic feedback.',
      })
    }
    if (!rule.listed) {
      return t({
        zh: '三個 profile 的 default_action 都是 ALLOW：採「黑名單」策略，只攔明列的高風險 syscall，以維持一般程式的相容性。',
        en: 'All three profiles use default_action ALLOW: a deny-list that only intercepts listed high-risk syscalls, keeping ordinary programs compatible.',
      })
    }
    return null
  })()

  return (
    <Section
      id="decisions"
      eyebrow={t({ zh: '決策路徑', en: 'Syscall decision path' })}
      title={t({ zh: '同一個 syscall，在不同 profile 會走不同的路。', en: 'The same syscall takes a different path under each profile.' })}
      lead={t({
        zh: '選一個 profile 與系統呼叫，看它在哪裡被決定、程式實際收到什麼、以及 AI 會得到哪一段回饋。規則與文字直接取自 profiles/*.json 與 mappings/syscall_feedback.json。',
        en: 'Pick a profile and a syscall to see where it is decided, what the process actually receives and which feedback the AI gets. Rules and wording come straight from profiles/*.json and mappings/syscall_feedback.json.',
      })}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold">Profile</legend>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {profiles.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setProfileName(p.name)}
                  aria-pressed={profileName === p.name}
                  className={`rounded-xl border px-3 py-2.5 font-mono text-sm transition ${
                    profileName === p.name ? 'border-[var(--brand-line)] bg-brand-soft text-brand-ink' : 'border-line bg-surface hover:bg-surface-2'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">{t({ zh: '系統呼叫', en: 'Syscall' })}</legend>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SYSCALLS.map((s) => {
                const a = lookup(profile, s.name).action
                return (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setSyscall(s.name)}
                    aria-pressed={syscall === s.name}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition ${
                      syscall === s.name ? 'border-[var(--brand-line)] bg-brand-soft' : 'border-line bg-surface hover:bg-surface-2'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[13px] font-medium">{s.name}()</span>
                      <span className="block truncate text-[11px] text-muted">{t(s)}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: `var(--${a.toLowerCase()})` }}
                    />
                  </button>
                )
              })}
            </div>
          </fieldset>
          <p className="text-xs leading-relaxed text-muted">
            {t({ zh: '色點代表此 profile 下的動作：', en: 'Dots show the action under this profile: ' })}
            <span className="whitespace-nowrap"><span className="mx-1 inline-block h-2 w-2 rounded-full bg-allow" />ALLOW</span>{' '}
            <span className="whitespace-nowrap"><span className="mx-1 inline-block h-2 w-2 rounded-full bg-errno" />ERRNO</span>{' '}
            <span className="whitespace-nowrap"><span className="mx-1 inline-block h-2 w-2 rounded-full bg-notify" />NOTIFY</span>{' '}
            <span className="whitespace-nowrap"><span className="mx-1 inline-block h-2 w-2 rounded-full bg-kill" />KILL</span>
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)] sm:p-6" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <code className="font-mono text-lg font-semibold">{syscall}()</code>
            <span className="text-muted">·</span>
            <span className="font-mono text-sm text-muted">{profile.name}</span>
            <ActionBadge action={rule.action} className="ml-auto" />
          </div>
          <p className="mt-1 text-xs text-muted">
            {rule.listed
              ? t({ zh: '明列於 profile 的 syscall_rules', en: 'listed in the profile’s syscall_rules' })
              : t({ zh: '未明列，套用 default_action', en: 'not listed, so default_action applies' })}
          </p>

          <div className="mt-5 space-y-2">
            <Stage active icon={<Cpu size={16} />} title={t({ zh: '① 核心內的 seccomp-BPF filter', en: '① seccomp-BPF filter in the kernel' })}>
              {viaListener
                ? t({ zh: '比對到規則，syscall 被暫停並交給 USER_NOTIF listener。', en: 'Rule matched: the syscall is parked and handed to the USER_NOTIF listener.' })
                : rule.action === 'ERRNO'
                  ? t({ zh: '比對到 ERRNO 規則，核心直接回覆錯誤碼。', en: 'ERRNO rule matched: the kernel answers with the error code directly.' })
                  : t({ zh: '沒有攔截規則，核心直接放行。', en: 'No intercepting rule: the kernel lets it through.' })}
            </Stage>
            <div className="flex justify-center text-muted"><ArrowDown size={16} /></div>
            <Stage active={viaListener} icon={<ShieldCheck size={16} />} title={t({ zh: '② Rust monitor 查 policy', en: '② Rust monitor consults the policy' })}>
              {viaListener
                ? t({
                    zh: `policy.lookup("${syscall}") → ${rule.action}；寫入 syscall_events（signal_name = ${rule.action === 'KILL' ? 'SIGKILL' : 'EPERM'}）。`,
                    en: `policy.lookup("${syscall}") → ${rule.action}; written to syscall_events (signal_name = ${rule.action === 'KILL' ? 'SIGKILL' : 'EPERM'}).`,
                  })
                : t({ zh: '不經過 monitor，也不產生稽核紀錄。', en: 'The monitor is not involved and no audit row is written.' })}
            </Stage>
            <div className="flex justify-center text-muted"><ArrowDown size={16} /></div>
            <Stage active icon={rule.action === 'KILL' ? <Skull size={16} /> : <Undo2 size={16} />} title={t({ zh: '③ 目標程式收到的結果', en: '③ What the process receives' })}>
              {t(out.process)}
            </Stage>
          </div>

          <div className="mt-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{t({ zh: 'AI 收到的語意回饋', en: 'Semantic feedback for the AI' })}</p>
            {out.feedback ? (
              <div className="term mt-2 rounded-xl p-4 font-mono text-[12.5px] leading-relaxed">
                <div className="text-[#fbbf24]">[SEMANTIC] {t({ zh: fb.zh, en: fb.en })}</div>
                <div className="mt-1 text-[#fdba74]">HINT → {t({ zh: fb.hint, en: fb.hintEn })}</div>
              </div>
            ) : (
              <p className="mt-2 rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">
                {t({ zh: '沒有：這條路徑不會通知 monitor。', en: 'None — this path never reaches the monitor.' })}
              </p>
            )}
          </div>

          {note && <p className="mt-5 border-t border-line pt-4 text-sm leading-relaxed text-fg-2">{note}</p>}
          {out.feedback &&
            t({
              zh: null,
              en: (
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  The monitor prints the Chinese message and hint; the English text here comes from the mapping’s en field and a translated hint.
                </p>
              ),
            })}
        </div>
      </div>
    </Section>
  )
}
