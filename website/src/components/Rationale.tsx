import { Section } from './ui'
import { useT } from '../prefs'

// Design decisions as documented in the source comments.
const DECISIONS = [
  {
    choice: 'SECCOMP_RET_USER_NOTIF',
    over: 'ptrace / SECCOMP_RET_TRACE',
    zh: '不必讓 tracer 附加在每個 syscall 上：ALLOW 在核心的 BPF 內就決定，只有命中規則的呼叫才經由一個 fd 交給 monitor。',
    en: 'No tracer sits on every syscall: ALLOW is decided inside the kernel’s BPF program and only matching calls reach the monitor through a single fd.',
    path: 'core/src/seccomp.c',
  },
  {
    choice: 'clone(CLONE_NEW* …)',
    over: 'unshare()',
    zh: 'child 一出生就在全部 namespace 裡，少一次切換，也沒有「先跑起來再隔離」的空窗。',
    en: 'The child is born inside every namespace — one fewer transition and no window where it runs before isolation.',
    path: 'core/src/sandbox.c',
  },
  {
    choice: 'pivot_root + MNT_DETACH',
    over: 'chroot',
    zh: 'chroot 可被逃逸；pivot_root 換掉整個根並卸載舊根，沙盒內不存在回到宿主的路徑。',
    en: 'chroot can be escaped; pivot_root swaps the whole root and detaches the old one, so no path back to the host exists.',
    path: 'core/src/overlayfs.c',
  },
  {
    choice: 'tmpfs upper layer',
    over: 'disk-backed writes',
    zh: '所有寫入都落在記憶體；重置沙盒只要丟掉 tmpfs，不需任何持久化清理。',
    en: 'All writes land in memory; resetting the sandbox means discarding the tmpfs, with no persistent cleanup.',
    path: 'core/src/overlayfs.c',
  },
  {
    choice: 'wait4()',
    over: 'waitpid()',
    zh: '一次呼叫同時拿到結束狀態與 rusage（CPU 時間、max RSS），對短命的 AI 程式碼最省成本。',
    en: 'Exit status and rusage (CPU time, max RSS) in one call — cheapest for short-lived AI code runs.',
    path: 'core/src/sandbox.c',
  },
  {
    choice: 'poll() → NOTIF_RECV',
    over: 'blocking ioctl',
    zh: '若沙盒從未觸發 NOTIFY 就結束，阻塞式 RECV 可能永遠醒不來；先 poll，收到 POLLHUP 即可乾淨退出。',
    en: 'If the sandbox exits without ever triggering NOTIFY, a blocking RECV may never wake; polling first lets POLLHUP end the loop cleanly.',
    path: 'monitor/src/main.rs',
  },
  {
    choice: 'sendmsg left unfiltered',
    over: 'blocking every socket call',
    zh: 'notify_fd 正是用 sendmsg(SCM_RIGHTS) 傳出去的；攔它會讓 child 被自己的 filter 卡死。攔 socket() / connect() 就足以斷網。',
    en: 'notify_fd itself is sent with sendmsg(SCM_RIGHTS); filtering it would deadlock the child on its own filter. Blocking socket() / connect() already cuts the network.',
    path: 'profiles/strict.json',
  },
  {
    choice: 'C core + Rust monitor',
    over: 'one process',
    zh: '貼近核心的設定用 C 最直接；處理 raw fd 與 ioctl 的決策迴圈交給 Rust 的借用檢查。兩者只靠 fd 繼承與環境變數溝通。',
    en: 'Kernel-facing setup is most direct in C; the decision loop that handles raw fds and ioctls gets Rust’s borrow checker. They share only inherited fds and env vars.',
    path: 'monitor/Cargo.toml',
  },
]

export function Rationale() {
  const t = useT()
  return (
    <Section
      id="rationale"
      eyebrow={t({ zh: '設計取捨', en: 'Design decisions' })}
      title={t({ zh: '為什麼這樣做，而不是那樣做。', en: 'Why it is built this way, and not the obvious way.' })}
      lead={t({
        zh: '以下取捨都寫在原始碼的註解裡，也是 SentinelBox 與「包一層 Docker」最大的差別。',
        en: 'Each trade-off below is documented in the source comments, and together they are what separates SentinelBox from “just wrap it in Docker”.',
      })}
    >
      <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2">
        {DECISIONS.map((d) => (
          <article key={d.choice} className="bg-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="font-mono text-[15px] font-semibold text-fg">{d.choice}</h3>
              <span className="font-mono text-xs text-muted">
                {t({ zh: '而非', en: 'over' })} <span className="line-through decoration-[var(--muted)]/60">{d.over}</span>
              </span>
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-fg-2">{t(d)}</p>
            <p className="mt-3 font-mono text-[11px] text-muted">{d.path}</p>
          </article>
        ))}
      </div>
    </Section>
  )
}
