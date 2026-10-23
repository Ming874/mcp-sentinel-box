// Typed view over the real profiles/*.json and mappings/syscall_feedback.json
// (copied by scripts/sync-data.mjs), plus the decision logic of the C core and
// Rust monitor so the explorer reproduces what the sandbox actually does.
import strictJson from './profile-strict.json'
import webJson from './profile-web.json'
import dataScienceJson from './profile-datascience.json'
import feedbackJson from './syscall-feedback.json'

export type Action = 'ALLOW' | 'ERRNO' | 'NOTIFY' | 'KILL'

export type Profile = {
  name: string
  description: string
  default_action: Action
  syscall_rules: { name: string; action: Action; errno?: number }[]
  resources: { mem_limit_bytes: number; cpu_max_quota: number; cpu_max_period: number; pids_max: number }
  network: { allow: boolean; allow_dns: boolean }
  _note_network?: string
}

type FeedbackEntry = { zh: string; en: string; hint: string }
export type Feedback = FeedbackEntry & { hintEn: string }

// The mapping ships hints in Chinese only; these translations are for the English page.
const HINT_EN: Record<string, string> = {
  default: 'If needed, consider switching profiles, or avoid calling {name}.',
  socket: 'Use data prepared outside the sandbox; this profile forbids any network connection.',
  connect: 'Process locally instead, or switch to a profile that allows networking (datascience / web).',
  bind: 'If you need to serve traffic, use the web profile with an allowed port range.',
  ptrace: 'Debuggers cannot attach inside the sandbox; remove ptrace / strace calls.',
  mount: 'The sandbox rootfs is a read-only overlay; remounting is neither needed nor allowed.',
  bpf: 'BPF and kernel modules are off-limits; use a user-space equivalent.',
  reboot: 'The sandbox user namespace has no such privilege; remove these calls.',
  userfaultfd: 'Unless you are doing kernel research, remove this call.',
  mknod: 'Do not create device nodes in the sandbox; use regular files, pipes or FIFOs.',
}
type FeedbackMap = { default: FeedbackEntry; groups: (FeedbackEntry & { syscalls: string[] })[] }

export const profiles: Profile[] = [strictJson, dataScienceJson, webJson] as Profile[]
const feedback = feedbackJson as FeedbackMap

export function getProfile(name: string): Profile {
  return profiles.find((p) => p.name === name) ?? profiles[0]
}

/** policy.rs `lookup`: last matching rule wins, otherwise the profile default. */
export function lookup(profile: Profile, syscall: string): { action: Action; errno: number; listed: boolean } {
  let hit: { action: Action; errno: number } | null = null
  for (const r of profile.syscall_rules) {
    if (r.name === syscall) hit = { action: r.action, errno: r.errno ?? 1 }
  }
  return hit ? { ...hit, listed: true } : { action: profile.default_action, errno: 1, listed: false }
}

/** feedback.rs `build`: group lookup with {name}/{profile}/{argN} substitution. */
export function semantic(profile: Profile, syscall: string, args: Record<number, string> = {}): Feedback {
  const group = feedback.groups.find((g) => g.syscalls.includes(syscall))
  const entry = group ?? feedback.default
  const hintEn = HINT_EN[group?.syscalls[0] ?? 'default'] ?? entry.hint
  const fill = (tpl: string) =>
    tpl
      .replaceAll('{name}', syscall)
      .replaceAll('{profile}', profile.name)
      .replace(/\{arg(\d)\}/g, (_, i: string) => args[Number(i)] ?? `{arg${i}}`)
  return { zh: fill(entry.zh), en: fill(entry.en), hint: fill(entry.hint), hintEn: fill(hintEn) }
}

export const OOM_FEEDBACK = {
  // Recorded by monitor/src/main.rs after the run when memory.events reports oom_kill.
  zh: '資源耗盡：行程超出記憶體限制被核心強制終止 (Cgroup memory.max violation)',
  hint: '改進方案：檢查是否有記憶體洩漏，或在 profile 中提高 memory.max 上限。',
  hintEn: 'Check for memory leaks, or raise memory.max in the profile.',
}

export function countActions(profile: Profile): Record<Action, number> {
  const counts: Record<Action, number> = { ALLOW: 0, ERRNO: 0, NOTIFY: 0, KILL: 0 }
  const seen = new Map<string, Action>()
  for (const r of profile.syscall_rules) seen.set(r.name, r.action)
  for (const a of seen.values()) counts[a]++
  return counts
}

export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${n / (1 << 30)} GiB`
  return `${n / (1 << 20)} MiB`
}

export function formatCpu(p: Profile): string {
  const cores = p.resources.cpu_max_quota / p.resources.cpu_max_period
  return `${cores} CPU`
}
