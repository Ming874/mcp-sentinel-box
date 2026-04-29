# SentinelBox: An Intelligent Sandbox for Secure AI Agent Execution

[![Project Status: Research/Prototype](https://img.shields.io/badge/Status-Prototype-blue.svg)](https://github.com/your-repo/sentinelbox)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

## 1. Introduction & Motivation
In the era of Generative AI, AI Agents frequently generate and execute code to solve complex tasks. However, executing unvetted, LLM-generated code poses significant security risks, ranging from accidental data deletion to intentional system exploitation.

**SentinelBox** is a "Context-Aware Sandbox" designed specifically for AI workflows. Beyond traditional isolation, it leverages the **Model Context Protocol (MCP)** to translate low-level kernel signals (hard failures) into high-level semantic feedback. This creates an autonomous **"Execute -> Fail -> Feedback -> Repair"** loop, allowing AI agents to understand *why* their code failed and how to fix it within security constraints.

---

## 2. System Architecture (Deep Dive)

The system is architected into four distinct layers, bridging the gap between Linux Kernel primitives and LLM reasoning:

### 2.1 Core Isolation Engine (C / Linux Kernel API)
The foundational layer responsible for physical isolation, optimized for high performance and strict security:
*   **Advanced Virtualization via Namespaces**:
    *   `CLONE_NEWPID`: Isolates the PID tree.
    *   `CLONE_NEWUSER`: Maps container-root to a non-privileged host user.
    *   `CLONE_NEWNS` & `pivot_root`: Utilizes **OverlayFS** with a **RAM-backed `tmpfs`** upper layer. This ensures all writes occur in memory, enabling sandbox resets in less than 10ms. Unlike `chroot`, `pivot_root` is used to prevent filesystem escape.
    *   `CLONE_NEWNET`: Disables external networking or restricts it via eBPF filters to implement zero-trust network access.
*   **High-Performance Syscall Filtering**:
    *   **`SECCOMP_RET_USER_NOTIF`**: Instead of high-latency `ptrace` (SECCOMP_RET_TRACE), SentinelBox uses the modern User Notification API (Linux 5.0+). This allows the monitor to handle syscalls via a dedicated file descriptor, reducing context-switch overhead by up to 80%.
*   **Cgroup v2 Unified Resource Control**:
    *   Strictly caps `cpu.max`, `memory.max`, and `pids.max`.
    *   **Capability Dropping**: Removes all unnecessary Linux capabilities (e.g., `CAP_SYS_ADMIN`, `CAP_NET_RAW`) even for the root user inside the sandbox.

### 2.2 Telemetry & Monitoring Layer (Rust / eBPF)
*   **eBPF & Cgroup v2 Integration**: Uses eBPF hooks and Cgroup v2 controllers to monitor kernel events and resource usage (CPU/Memory/IO) without the overhead of polling `/proc`.
*   **Zero-Latency Data Streaming**: Data is streamed asynchronously to the monitoring service via high-speed Ring Buffers, providing the raw metrics for the real-time dashboard.

### 2.3 AI Orchestration Layer (MCP Server - Python / TypeScript)
*   **Semantic Translator**: An asynchronous bridge that maps `EPERM`, `SIGSYS`, or `OOM-Kill` events into actionable natural language feedback.
*   **Database Integration (WAL Mode)**: Stores execution history and audit logs in **SQLite** with Write-Ahead Logging enabled, ensuring non-blocking performance during concurrent AI task executions.

### 2.4 Management UI (React / Tailwind)
*   **Real-time Performance Dashboard**: (Required Implementation) Visualizes per-millisecond execution metrics (CPU/RAM) and real-time syscall interception logs.
*   **Security Audit Explorer**: Provides a searchable history of AI agent behaviors and security violations, backed by the SQLite audit engine.

---

## 3. High-Performance Implementation Strategy

To achieve industrial-grade performance and reduce cross-language overhead, SentinelBox employs the following strategies:

*   **Integrated Core & Telemetry**: Leverages Rust's memory safety and performance for both Seccomp notification handling and eBPF telemetry, minimizing context-switching between tools.
*   **Asynchronous Actor Model**: The internal communication between the Monitor (Rust) and the MCP Server (Node/Python) follows an Actor Model pattern to prevent blocking the isolation engine.
*   **Zero-Copy Telemetry**: Leverages shared memory and Ring Buffers for transferring telemetry data, minimizing CPU cycles spent on memory copies.
*   **Predictive Reset**: Pre-allocates cold sandbox instances in the background to ensure "Instant-On" availability for the AI Agent.

---

## 4. The "Semantic Feedback" Innovation

Traditional sandboxes return cryptic exit codes. SentinelBox provides **Actionable Intelligence**:

| Raw Signal | Kernel Cause | SentinelBox Semantic Feedback (via MCP) |
| :--- | :--- | :--- |
| `Exit Code 1` | `ImportError: os` | "Security Violation: Access to 'os' module is restricted in this profile." |
| `SIGSYS` | Blocked `socket()` | "Action Denied: Your code attempted to open a network connection. Only local processing is allowed." |
| `OOM Killed` | Memory Limit | "Resource Exhausted: The process exceeded 128MB RAM. Optimize your memory usage or request a higher tier." |

---

## 5. Security Model & Profiles

SentinelBox supports pre-defined security templates with dynamic permission negotiation:

*   **Strict (Default)**: No network, immutable filesystem, whitelist of essential syscalls.
*   **Data Science**: Limited network (whitelisted PyPI), high memory limit, Read-Only data access.
*   **Web Agent**: Restricted HTTP access, browser-specific syscall whitelist.

---

## 6. System Requirements

*   **OS**: Linux Kernel 5.15+ (Required for Cgroup v2 and User Notification optimizations).
*   **Permissions**: Designed for **Rootless** operation via User Namespaces.
*   **Dependencies**: `libseccomp`, `pkg-config`, `python 3.10+`, `busybox` (base rootfs).

---

## 7. Roadmap & Progress

| Phase | Milestone | Core Technologies | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Container Primitives | C/Rust, Linux Namespaces | Completed |
| **Phase 2** | Security Sentinel | Seccomp UserNotif, Rust | In Progress |
| **Phase 3** | Telemetry & Database | eBPF, SQLite WAL | In Progress |
| **Phase 4** | MCP Integration | Async SDK, Python | Planned |
| **Phase 5** | Management UI | React, Tailwind | Planned |

---

## 8. Getting Started

### Prerequisites
```bash
# Install dependencies (Ubuntu/Debian)
sudo apt install libseccomp-dev build-essential python3-pip
```

### Build & Run
```bash
# Build the isolation engine
make build

# Run a Python script in the sandbox
./sentinelbox --profile strict --code "print('hello world')"
```

## 9. Required Project Deliverables
To comply with the UNIX System Programming course requirements, the following documents are maintained:
*   **`CONTRIBUTING.md`**: Contribution guidelines, development environment setup, and coding standards.
*   **`man` page**: Technical manual accessible via `man ./docs/sentinelbox.1` covering command-line options and security profiles.
*   **Performance Benchmark Report**: Comparative analysis of sandbox overhead and reset latency.
