import { CodeBlock, Section } from './ui'
import { useT } from '../prefs'

const TOOLS = [
  {
    name: 'translate_error',
    zh: '把底層訊號（signal / errno / syscall / path）翻成 AI 讀得懂的說明。',
    en: 'Turns low-level signals (signal / errno / syscall / path) into an explanation an AI can use.',
    params: ['signal?', 'errno?', 'syscall?', 'path?', 'details?'],
  },
  {
    name: 'suggest_repair',
    zh: '依被擋下的 syscall 與當前 profile，給出程式碼的修正方向。',
    en: 'Suggests how to change the code, given the blocked syscall and the active profile.',
    params: ['syscall', 'original_code', 'profile?'],
  },
]

const CONFIG = `{
  "mcpServers": {
    "sentinelbox": {
      "command": "node",
      "args": ["/path/to/mcp-sentinel-box/mcp-server/dist/index.js"]
    }
  }
}`

// Output reproduced from mcp-server/src/services/translator.ts.
const EXCHANGE = `→ tools/call  translate_error
  { "errno": "EPERM", "syscall": "socket" }

← Security Violation: Operation not permitted. You are trying
  to access a restricted resource. The violation occurred
  during the \`socket\` system call.

→ tools/call  suggest_repair
  { "syscall": "connect", "profile": "strict",
    "original_code": "requests.get(url)" }

← Based on the blocked syscall 'connect', here is the repair
  strategy: The code attempts to access the network. In the
  'strict' profile, networking is disabled.
  Repair Suggestion: Replace network requests with local mock
  data or read from a pre-mounted dataset in the workspace.
  …`

export function Mcp() {
  const t = useT()
  return (
    <Section
      id="mcp"
      eyebrow="Model Context Protocol"
      title={t({ zh: '讓任何支援 MCP 的 Agent 直接接上。', en: 'Plug into any agent that speaks MCP.' })}
      lead={t({
        zh: 'MCP 伺服器以 stdio 執行，提供兩個工具。Agent 在執行失敗後呼叫它們，取得原因與修正方向，再改寫程式碼重試——不需要人介入。',
        en: 'The MCP server runs over stdio and exposes two tools. After a failed run the agent calls them for the cause and a repair direction, rewrites its code and retries — without a human in the loop.',
      })}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {TOOLS.map((tool) => (
            <article key={tool.name} className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow)]">
              <h3 className="font-mono text-base font-semibold text-brand-ink">{tool.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-2">{t(tool)}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tool.params.map((p) => (
                  <span key={p} className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg-2">{p}</span>
                ))}
              </div>
            </article>
          ))}
          <CodeBlock label="claude_desktop_config.json" code={CONFIG} />
        </div>
        <div className="term overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--t-line)] px-4 py-2 font-mono text-[11px] text-[var(--t-muted)]">
            {t({ zh: '範例：一次失敗後的兩個工具呼叫', en: 'Example: two tool calls after a failure' })}
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed">
            {EXCHANGE.split('\n').map((line, i) => (
              <div key={i} className={line.startsWith('→') ? 'text-[#fdba74]' : line.startsWith('←') ? 'text-[#86efac]' : 'text-[#d4d4d8]'}>
                {line || ' '}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </Section>
  )
}
