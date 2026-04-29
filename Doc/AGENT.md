# SentinelBox: AI Agent Implementation Guide & Project Constraints

This document provides essential context, architectural mandates, and implementation guidelines for AI agents contributing to the **SentinelBox** project. Adherence to these standards is critical for maintaining system security, performance, and the integrity of the semantic feedback loop.

---

## 1. Project Philosophy: "Semantic Security"
SentinelBox is not just a container; it is an **interpretive layer** between the Linux Kernel and Large Language Models. 
*   **Goal**: Transform hard kernel failures (traps, signals, errors) into actionable natural language feedback.
*   **Success Metric**: An AI Agent executes code, fails due to a security policy, understands the failure via the MCP feedback, and successfully refactors its code to comply.

---

## 2. Technical Stack & Architectural Constraints

### 2.1 Core Isolation Engine (C / Rust)
*   **Namespaces**: Must implement `CLONE_NEWUSER` (Rootless mode), `CLONE_NEWPID`, `CLONE_NEWNS`, and `CLONE_NEWNET`.
*   **Filesystem**: Use `pivot_root` instead of `chroot` to prevent escape. Implement **OverlayFS** with a `tmpfs` upper layer for ephemeral, high-speed resets.
*   **Syscall Filtering**: **Mandatory** use of `SECCOMP_RET_USER_NOTIF`. Do NOT use `ptrace` for interception due to performance overhead.
*   **Resource Control**: Target **Cgroup v2 unified hierarchy** only.

### 2.2 Telemetry Layer (Rust / eBPF)
*   **Zero-Copy**: Use eBPF Ring Buffers for data transfer. Avoid polling `/proc` or `/sys` in high-frequency loops.
*   **Safety**: All Rust code interacting with the kernel must be strictly audited. Minimize `unsafe` blocks to the absolute FFI requirements.

### 2.3 AI Orchestration (Python/TS + MCP)
*   **Protocol**: Follow the **Model Context Protocol (MCP)** specification strictly.
*   **Latency**: The Semantic Translator must be asynchronous. It should never block the Core Isolation Engine's syscall notification handler.

---

## 3. Implementation Guardrails (The "Never" List)

1.  **Never** run the sandbox as a privileged host root. Always use User Namespaces.
2.  **Never** hardcode syscall IDs; use `libseccomp` or kernel headers to maintain cross-architecture compatibility (x86_64/AArch64).
3.  **Never** return raw errno strings (e.g., "EPERM") directly to the LLM. Always map them through the `Semantic Translator`.
4.  **Never** use persistent storage for the sandbox's writable layer. Use `tmpfs` to ensure a clean state upon every reset.

---

## 4. Development Workflow for Agents

### Step 1: Research & Discovery
Before modifying kernel-level code, verify the host kernel version (`uname -r`).
*   Required: **Linux Kernel 5.15+** (for full Cgroup v2 and Seccomp UserNotif support).

### Step 2: Implementation Priority
1.  **Isolation Primitives**: Establish Namespaces and `pivot_root`.
2.  **Seccomp Handler**: Implement the User Notification listener in the Monitor.
3.  **MCP Mapping**: Create the JSON mapping between `syscall_nr` + `errno` and semantic strings.
4.  **Telemetry**: Hook eBPF probes for resource usage.

### Step 3: Verification
Every feature must be validated using the following loop:
1.  **Unit Test**: Test individual C/Rust modules.
2.  **Integration Test**: Execute a "Malicious" Python script (e.g., `os.mkdir('/')`) and verify it is blocked.
3.  **Semantic Test**: Verify the AI Agent receives a high-level explanation of the block, not just a crash.

---

## 5. Security Profile Schema
When adding new profiles (e.g., `strict.json`), follow this structure:
*   **Syscall Whitelist**: Explicitly listed allowed syscalls.
*   **Resource Quotas**: `cpu_limit`, `mem_limit`, `pids_max`.
*   **Network Policy**: `allow_dns`, `allowed_ips` (handled via eBPF).

---

## 6. Communication Protocol
Internal signals between the C monitor and the Rust/Python layers should use **Unix Domain Sockets** or **Shared Memory** for minimal latency. Avoid TCP/HTTP for internal IPC.

---

## 7. Useful Commands for Agents
*   Check Seccomp support: `cat /proc/sys/kernel/seccomp/actions_avail`
*   Monitor Cgroup events: `udevadm monitor` or watching `/sys/fs/cgroup/`
*   Trace syscalls during dev: `strace -f ./sentinelbox ...`

**Remember: You are building a system that teaches AI how to be secure. Be precise, be performant, and be semantic.**
