import { ArrowRight } from 'lucide-react'
import { ActionBadge, Section } from './ui'
import { useT } from '../prefs'
import { getProfile, OOM_FEEDBACK, semantic, type Action } from '../data/model'

export function Problem() {
  const t = useT()
  const strict = getProfile('strict')
  const net = semantic(strict, 'socket', { 0: '2' })
  const mnt = semantic(strict, 'mount')

  const rows: { action: Action; trigger: string; raw: string; zh: string; en: string; hint: string; hintEn: string }[] = [
    { action: 'NOTIFY', trigger: 'socket(AF_INET, …)', raw: 'nc: socket: Operation not permitted', zh: net.zh, en: net.en, hint: net.hint, hintEn: net.hintEn },
    { action: 'KILL', trigger: 'mount("proc", …)', raw: 'Killed            exit 137', zh: mnt.zh, en: mnt.en, hint: mnt.hint, hintEn: mnt.hintEn },
    { action: 'KILL', trigger: 'memory.max exceeded', raw: 'Killed            exit 137', zh: OOM_FEEDBACK.zh, en: 'Resource exhausted: the process exceeded its memory limit and was killed by the kernel (cgroup memory.max violation).', hint: OOM_FEEDBACK.hint, hintEn: OOM_FEEDBACK.hintEn },
  ]

  return (
    <Section
      id="problem"
      eyebrow={t({ zh: '語意落差', en: 'The semantic gap' })}
      title={t({ zh: '傳統沙盒只回一個錯誤碼，AI 只能瞎猜。', en: 'A plain sandbox returns an error code. The agent is left guessing.' })}
      lead={t({
        zh: '「Operation not permitted」或「Killed」對 LLM 來說幾乎沒有資訊量：是程式寫錯、權限不足，還是政策禁止？SentinelBox 在攔截的當下就知道是哪個 syscall、哪條規則，於是能回答「為什麼」與「怎麼改」，形成「執行 → 失敗 → 回饋 → 修正」的閉環。',
        en: '“Operation not permitted” or “Killed” tells an LLM almost nothing: a bug, a missing permission, or a policy decision? SentinelBox knows the exact syscall and rule at the moment of interception, so it can answer why and what to change — closing the execute → fail → feedback → repair loop.',
      })}
    >
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow)]">
        <div className="hidden grid-cols-[1fr_auto_1.6fr] gap-6 border-b border-line bg-surface-2 px-6 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted md:grid">
          <span>{t({ zh: '一般沙盒看到的', en: 'What a plain sandbox shows' })}</span>
          <span />
          <span>{t({ zh: 'SentinelBox 給 AI 的', en: 'What SentinelBox tells the agent' })}</span>
        </div>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.trigger} className="grid gap-4 px-5 py-5 md:grid-cols-[1fr_auto_1.6fr] md:items-center md:gap-6 md:px-6">
              <div>
                <div className="flex items-center gap-2">
                  <ActionBadge action={r.action} />
                  <code className="font-mono text-xs text-muted">{r.trigger}</code>
                </div>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-[13px] text-kill">{r.raw}</pre>
              </div>
              <ArrowRight className="hidden text-muted md:block" size={18} aria-hidden="true" />
              <div className="rounded-xl bg-surface-2 p-4">
                <p className="text-sm font-medium leading-relaxed">{t({ zh: r.zh, en: r.en })}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-2">
                  <span className="font-mono text-xs font-semibold text-brand-ink">HINT </span>
                  {t({ zh: r.hint, en: r.hintEn })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  )
}
