# SentinelBox GitHub Wiki

Welcome to the SentinelBox Wiki! This project provides a secure, semantic-aware sandbox for AI Agent code execution.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Getting Started](#getting-started)
3. [Security Profiles](#security-profiles)
4. [Semantic Feedback Loop](#semantic-feedback-loop)
5. [Troubleshooting](#troubleshooting)

---

## Architecture Overview
SentinelBox is built on four main pillars:
- **Core (C)**: Low-level isolation using Linux Namespaces and Seccomp.
- **Monitor (Rust)**: High-performance observability and resource sampling.
- **MCP Server (TypeScript)**: The semantic bridge for AI Agents.
- **Dashboard (React)**: Real-time visualization of sandbox activity.

For a detailed deep dive, see [ARCHITECTURE.md](../docs/ARCHITECTURE.md).

---

## Getting Started

### Prerequisites
- Linux Kernel 5.15+
- Node.js 20+
- Rust (Stable)
- Build Essentials (gcc, make)
- `libseccomp-dev`, `libcap-dev`

### Installation
```bash
# Clone the repository
git clone https://github.com/Ming874/mcp-sentinel-box.git
cd mcp-sentinel-box

# One-click provisioning
bash scripts/provision.sh
```

### Running the System
1. **Start the Dashboard & Bridge**:
   ```bash
   ./scripts/start_monitoring.sh
   ```
2. **Execute a Task**:
   ```bash
   bash scripts/run.sh -- /bin/sh -c "echo Hello World"
   ```

---

## Security Profiles
Profiles are defined in `profiles/*.json`.
- **Strict**: No network, restricted syscalls.
- **DataScience**: Higher memory, allowed NumPy/Pandas related calls.
- **Web**: Controlled outbound network access.

---

## Semantic Feedback Loop
When a syscall is blocked, the following happens:
1. Kernel traps the call via `SECCOMP_RET_USER_NOTIF`.
2. Rust Monitor identifies the violation.
3. Violation is logged to SQLite with context.
4. MCP Server translates the error into: *"Security Violation: Network access is prohibited in this profile."*

---

## Troubleshooting

### Cgroup Creation Errors
If you see `Permission denied` when creating cgroups, it's likely due to lack of Cgroup v2 delegation.
**Solution**: The system will automatically fallback to global telemetry. For full isolation, run on a host with delegation enabled (see `scripts/setup_cgroup.sh`).

### Port Conflicts
If port 3000 or 3001 is in use:
```bash
pkill -f "node src/index.js"
pkill -f "vite"
```
