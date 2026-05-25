# SentinelBox GitHub Wiki: The Ultimate Guide

Welcome to the comprehensive SentinelBox Wiki. This project is a state-of-the-art security engine designed specifically for **AI Agents**. It bridges the gap between raw Linux kernel security primitives and high-level AI reasoning by providing "Semantic Feedback" when security policies are violated.

---

## 1. Architecture Overview: The Multi-Layer Defense

SentinelBox is structured into four distinct layers, each leveraging a language best suited for its domain:

### Core (The Warden) - Written in C
The heart of the sandbox. It handles the "dirty work" of Linux kernel isolation.
- **Namespaces**: Mount, UTS, IPC, Network, and User namespaces ensure the child process is completely jailed.
- **Seccomp User Notification**: Instead of just killing a process, Core uses `SECCOMP_RET_USER_NOTIF` to pass forbidden syscalls to the Monitor for decision-making.
- **Capabilities**: Drops all sensitive Linux capabilities (e.g., `CAP_SYS_ADMIN`) even if the child runs as root.

### Monitor (The Watcher) - Written in Rust
A high-performance observability daemon that supervises the sandbox.
- **Decision Engine**: Receives notification FDs from the Core and decides whether to allow, deny (with errno), or kill based on the active Profile.
- **Telemetry**: Samples Cgroup v2 metrics (CPU/Memory) every 100ms.
- **Audit Logging**: Persists every single security event and resource sample into a local SQLite database for forensics.

### MCP Server (The Bridge) - Written in TypeScript
The interface for LLMs (Large Language Models).
- **Model Context Protocol**: Implements the MCP standard, allowing agents like Claude or GPT-4 to "query" the sandbox state.
- **Semantic Translation**: Converts cryptic kernel errors (e.g., `EPERM`) into actionable natural language hints using the Feedback Map.

### Dashboard (The Command Center) - Written in React
A modern, real-time web interface.
- **Live Stream**: Uses Socket.io to push telemetry and security violations to the browser.
- **Visual Analytics**: Real-time charts for CPU and Memory tracking.
- **Management**: Allows operators to manually terminate (Kill) any active sandbox session.

---

## 2. Getting Started: From Zero to Secure

### Prerequisites
Your host system must meet these requirements:
- **Kernel**: 5.15 or newer (Required for `SECCOMP_USER_NOTIF`).
- **Dependencies**: 
  - `libseccomp-dev`, `libcap-dev` (System libraries)
  - `Node.js v20+` & `npm`
  - `Rust (stable)`
  - `gcc` & `make`

### Rapid Deployment
We provide a one-click script to set up everything (compiling C/Rust, installing NPM deps, setting up rootfs):
```bash
# Provision the entire environment
bash scripts/provision.sh
```

### Running Your First Sandbox
To run a command inside the `strict` profile:
```bash
# 1. Start the monitoring bridge (Dashboard + MCP)
./scripts/start_monitoring.sh

# 2. In a new terminal, run a shell inside the sandbox
bash scripts/run.sh --profile=strict -- /bin/sh
```

---

## 3. Security Profiles & Semantic Feedback

### Profile Configuration
Profiles live in `profiles/*.json`. They define the "Laws of the Land".
- `name`: Human-readable name.
- `rules`: A mapping of syscall names to actions (`ALLOW`, `ERRNO`, `KILL`, `NOTIFY`).
- `default_action`: What to do if a syscall isn't listed.

### The Magic of Semantic Feedback
Standard sandboxes just return "Permission Denied". SentinelBox returns **Meaning**.
When a syscall is blocked, the Monitor looks up `mappings/syscall_feedback.json`:

**Example Mapping:**
```json
{
  "syscalls": ["connect"],
  "zh": "動作拒絕：程式碼嘗試對外連線 ({name})。",
  "hint": "請改用本地處理；或切換到允許網路的 profile (web)。"
}
```
The AI Agent receives the `hint`, allowing it to **self-correct** its code without human intervention.

---

## 4. Telemetry & Observability

### Resource Tracking
SentinelBox uses **Cgroup v2** for ultra-low-overhead resource monitoring. 
- **Memory**: Current and Peak memory usage (Bytes).
- **CPU**: Precise usage in microseconds (μs), normalized by core count.
- **Fallback**: If Cgroup v2 is not delegated on the host, the system automatically falls back to procfs-based global sampling.

### Audit Database (`sentinelbox.db`)
Every event is recorded in SQLite. You can query it directly:
```sql
-- Find the last 5 security violations
SELECT time, syscall, signal_name, semantic_en 
FROM syscall_events 
WHERE action = 'KILL' 
ORDER BY id DESC LIMIT 5;
```

---

## 5. Advanced: MCP Integration

To connect SentinelBox to **Claude Desktop**:
1. Open your Claude Desktop config (`~/.config/Claude/claude_desktop_config.json`).
2. Add the following entry:
```json
{
  "mcpServers": {
    "sentinelbox": {
      "command": "node",
      "args": ["/path/to/mcp-sentinel-box/mcp-server/dist/index.js"]
    }
  }
}
```

---

## 6. Troubleshooting

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| `SECCOMP_USER_NOTIF` not supported | Kernel too old | Upgrade to Linux 5.15+. |
| `cgroup` directory not writable | No cgroup delegation | Run `sudo scripts/setup_cgroup.sh` or run as root. |
| Dashboard shows no data | Bridge not started | Ensure `scripts/start_monitoring.sh` is running. |
| Dashboard ports (3000/3001) busy | Dead processes | Run `pkill -f node` and `pkill -f vite`. |

---

## 7. Comparison: SentinelBox vs. Docker

| Feature | SentinelBox | Docker |
| :--- | :--- | :--- |
| **Startup Latency** | **< 10ms** | ~500ms - 2s |
| **Feedback** | **Semantic Hints** | Exit Code / Errno only |
| **Observability** | **Real-time 100ms** | `docker stats` (poll based) |
| **AI Focus** | **Native MCP Bridge** | Requires manual wrapping |
| **Isolation** | Lightweight Namespaces | Layered Images (Heavy) |

---
*Last Updated: May 2026*
