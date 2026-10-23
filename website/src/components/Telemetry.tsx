import { CodeBlock, Section } from './ui'
import { useT } from '../prefs'

// Mirrors monitor/migrations/001_init.sql and monitor/src/telemetry.rs.
const TABLES = [
  {
    name: 'syscall_events',
    zh: '每一次 NOTIFY / KILL 攔截',
    en: 'One row per NOTIFY / KILL interception',
    cols: [
      ['exec_id', 'FK'],
      ['ts', 'ms'],
      ['syscall_nr', 'x86_64'],
      ['syscall_name', ''],
      ['action', 'NOTIFY | KILL'],
      ['errno', ''],
      ['signal_name', 'EPERM | SIGKILL'],
      ['semantic_msg', ''],
    ],
  },
  {
    name: 'executions',
    zh: '每一次沙盒執行',
    en: 'One row per sandbox run',
    cols: [
      ['id', 'PK'],
      ['profile', ''],
      ['pid', 'host'],
      ['command', 'argv'],
      ['start_ts', 'ms'],
      ['end_ts', 'NULL = running'],
      ['status', ''],
    ],
  },
  {
    name: 'resource_samples',
    zh: '每 100 ms 一筆取樣',
    en: 'One row every 100 ms',
    cols: [
      ['exec_id', 'FK'],
      ['ts', 'ms'],
      ['mem_bytes', 'memory.current'],
      ['cpu_usec', 'cpu.stat'],
      ['cpu_pct', 'Δ / interval'],
    ],
  },
] as const

function Table({ t: table, center }: { t: (typeof TABLES)[number]; center?: boolean }) {
  const t = useT()
  return (
    <div className={`overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow)] ${center ? 'border-[var(--brand-line)]' : 'border-line'}`}>
      <div className={`border-b px-4 py-3 ${center ? 'border-[var(--brand-line)] bg-brand-soft' : 'border-line bg-surface-2'}`}>
        <p className="font-mono text-sm font-semibold">{table.name}</p>
        <p className="mt-0.5 text-xs text-muted">{t(table)}</p>
      </div>
      <ul className="divide-y divide-line">
        {table.cols.map(([c, note]) => (
          <li key={c} className="flex items-center justify-between gap-3 px-4 py-2 font-mono text-[12.5px]">
            <span className={note === 'PK' || note === 'FK' ? 'text-brand-ink' : 'text-fg-2'}>{c}</span>
            {note && <span className="truncate text-[11px] text-muted">{note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Connector({ label, flip }: { label: string; flip?: boolean }) {
  return (
    <div className="hidden items-center lg:flex" aria-hidden="true">
      <svg viewBox="0 0 64 40" className="w-full">
        {/* Crow's foot on the "many" side, a bar on the "one" side. */}
        <g transform={flip ? 'translate(64 0) scale(-1 1)' : undefined}>
          <line x1="2" y1="20" x2="62" y2="20" style={{ stroke: 'var(--brand)', strokeWidth: 1.5 }} />
          <path d="M2 12 L10 20 L2 28" fill="none" style={{ stroke: 'var(--brand)', strokeWidth: 1.5 }} />
          <line x1="56" y1="12" x2="56" y2="28" style={{ stroke: 'var(--brand)', strokeWidth: 1.5 }} />
        </g>
        <text x="32" y="12" textAnchor="middle" className="font-mono" style={{ fill: 'var(--muted)', fontSize: 8 }}>{label}</text>
      </svg>
    </div>
  )
}

export function Telemetry() {
  const t = useT()
  const facts = [
    {
      k: '100 ms',
      zh: '取樣執行緒預先開好 memory.current 與 cpu.stat，每輪 seek(0) 重讀，避免重複 open。',
      en: 'The sampler keeps memory.current and cpu.stat open and seeks back each tick instead of reopening.',
    },
    {
      k: 'cpu_pct',
      zh: '以 cpu.stat 的 usage_usec 差值除以實際經過時間計算；多核心時可超過 100%。',
      en: 'Computed from the usage_usec delta over the real elapsed time; can exceed 100% on several cores.',
    },
    {
      k: 'fallback',
      zh: 'cgroup 無法委派時改讀 /proc/stat、/proc/meminfo；核心端另以 wait4() 的 rusage 補上總用量。',
      en: 'Without cgroup delegation it reads /proc/stat and /proc/meminfo; the core also fills totals from wait4() rusage.',
    },
    {
      k: 'OOM',
      zh: '結束時讀 memory.events 的 oom_kill，若被核心 OOM kill 就補記一筆語意事件。',
      en: 'At exit it reads oom_kill from memory.events and records a semantic event if the kernel OOM-killed the run.',
    },
  ]

  return (
    <Section
      id="telemetry"
      eyebrow={t({ zh: '遙測與稽核', en: 'Telemetry & audit' })}
      title={t({ zh: '每一次攔截與資源曲線，都留下可查詢的紀錄。', en: 'Every interception and resource curve is left as a queryable record.' })}
      lead={t({
        zh: '稽核資料庫採 SQLite WAL 模式：monitor 持續寫入的同時，Bridge、Dashboard 與 MCP 端都能並行讀取。數值一律存原始值，時間戳統一為毫秒，換算交給前端。',
        en: 'The audit store is SQLite in WAL mode, so the monitor can keep writing while the bridge, dashboard and MCP side read concurrently. Values are stored raw with millisecond timestamps; conversion happens at the edge.',
      })}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_64px_1fr_64px_1fr] lg:items-start">
        <Table t={TABLES[0]} />
        <Connector label="N : 1" />
        <Table t={TABLES[1]} center />
        <Connector label="1 : N" flip />
        <Table t={TABLES[2]} />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
          {facts.map((f) => (
            <div key={f.k} className="bg-surface p-5">
              <dt className="font-mono text-sm font-semibold text-brand-ink">{f.k}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-fg-2">{t(f)}</dd>
            </div>
          ))}
        </dl>
        <div>
          <CodeBlock
            label={t({ zh: '查詢最近 5 筆被攔截的 syscall', en: 'Last five intercepted syscalls' })}
            code={`SELECT datetime(e.ts / 1000, 'unixepoch') AS at,
       x.profile, e.syscall_name, e.action,
       e.signal_name, e.semantic_msg
FROM   syscall_events e
JOIN   executions x ON x.id = e.exec_id
ORDER  BY e.id DESC
LIMIT  5;`}
          />
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {t({
              zh: 'PRAGMA：journal_mode=WAL、synchronous=NORMAL、busy_timeout=5000。monitor 與取樣執行緒共用同一個連線（Arc<Mutex>），避免多個 writer 互搶。',
              en: 'PRAGMAs: journal_mode=WAL, synchronous=NORMAL, busy_timeout=5000. The monitor and sampler share one connection behind Arc<Mutex> so writers never contend.',
            })}
          </p>
        </div>
      </div>
    </Section>
  )
}
