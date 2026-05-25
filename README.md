# SentinelBox: An Intelligent Sandbox for Secure AI Agent Execution

[![Project Status: Research/Prototype](https://img.shields.io/badge/Status-Prototype-blue.svg)](https://github.com/your-repo/sentinelbox)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

## 1. Introduction & Motivation
In the era of Generative AI, AI Agents frequently generate and execute code to solve complex tasks. However, executing unvetted, LLM-generated code poses significant security risks, ranging from accidental data deletion to intentional system exploitation.

**SentinelBox** is a "Context-Aware Sandbox" designed specifically for AI workflows. Beyond traditional isolation, it leverages the **Model Context Protocol (MCP)** to translate low-level kernel signals (hard failures) into high-level semantic feedback. This creates an autonomous **"Execute -> Fail -> Feedback -> Repair"** loop, allowing AI agents to understand *why* their code failed and how to fix it within security constraints.

---

## 2. Project Structure

SentinelBox adopts a decoupled, multi-layered architecture to ensure stability, security, and extensibility:

*   **`core/`**: Sandbox Isolation Engine (C). The foundational layer responsible for physical isolation via Linux Namespaces, OverlayFS, and Seccomp filters.
*   **`monitor/`**: Security Sentinel & Resource Sampling (Rust). A high-performance monitor that intercepts syscalls via `SECCOMP_RET_USER_NOTIF` and records telemetry to SQLite.
*   **`mcp-server/`**: MCP Server for AI Agents (TypeScript). Implements the Model Context Protocol to translate low-level kernel errors into actionable semantic feedback for LLMs.
*   **`server/`**: Backend Data Bridge (Express + Socket.io). Relays SQLite audit logs and telemetry to the frontend via WebSockets.
*   **`dashboard/`**: Frontend Monitoring Dashboard (React + Vite). A modern, real-time UI visualizing CPU/Memory metrics and security events.
*   **`docs/scripts/`**: Project documentation and auxiliary generation scripts.

---

## 3. System Architecture (Deep Dive)

The system is architected into four distinct layers, bridging the gap between Linux Kernel primitives and LLM reasoning:

### 3.1 Core Isolation Engine (C / Linux Kernel API)
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
    *   **Capability Dropping & Core Dump Prevention**: Removes all unnecessary Linux capabilities (e.g., `CAP_SYS_ADMIN`, `CAP_NET_RAW`) and enforces `prctl(PR_SET_DUMPABLE, 0)` to prevent host memory leaks from crashed sandboxes.
*   **High-Performance Observability**:
    *   Uses `wait4()` instead of `waitpid()` to atomically retrieve both the exit status and detailed resource usage (`rusage`) in a single syscall, drastically reducing overhead for one-shot AI code executions.

### 3.2 Telemetry & Monitoring Layer (Rust / eBPF)
*   **eBPF & Cgroup v2 Integration**: Uses eBPF hooks and Cgroup v2 controllers to monitor kernel events and resource usage (CPU/Memory/IO) without the overhead of polling `/proc`.
*   **Zero-Latency Data Streaming**: Data is streamed asynchronously to the monitoring service via high-speed Ring Buffers, providing the raw metrics for the real-time dashboard.

### 3.3 AI Orchestration Layer (MCP Server - Python / TypeScript)
*   **Semantic Translator**: An asynchronous bridge that maps `EPERM`, `SIGSYS`, or `OOM-Kill` events into actionable natural language feedback.
*   **Database Integration (WAL Mode)**: Stores execution history and audit logs in **SQLite** with Write-Ahead Logging enabled, ensuring non-blocking performance during concurrent AI task executions.

### 3.4 Management UI (React / Tailwind)
*   **Real-time Performance Dashboard**: (Required Implementation) Visualizes per-millisecond execution metrics (CPU/RAM) and real-time syscall interception logs.
*   **Security Audit Explorer**: Provides a searchable history of AI agent behaviors and security violations, backed by the SQLite audit engine.

---

## 4. High-Performance Implementation Strategy

To achieve industrial-grade performance and reduce cross-language overhead, SentinelBox employs the following strategies:

*   **Integrated Core & Telemetry**: Leverages Rust's memory safety and performance for both Seccomp notification handling and eBPF telemetry, minimizing context-switching between tools.
*   **Asynchronous Actor Model**: The internal communication between the Monitor (Rust) and the MCP Server (Node/Python) follows an Actor Model pattern to prevent blocking the isolation engine.
*   **Zero-Copy Telemetry**: Leverages shared memory and Ring Buffers for transferring telemetry data, minimizing CPU cycles spent on memory copies.
*   **Predictive Reset**: Pre-allocates cold sandbox instances in the background to ensure "Instant-On" availability for the AI Agent.

---

## 5. The "Semantic Feedback" Innovation

Traditional sandboxes return cryptic exit codes. SentinelBox provides **Actionable Intelligence**:

| Raw Signal | Kernel Cause | SentinelBox Semantic Feedback (via MCP) |
| :--- | :--- | :--- |
| `Exit Code 1` | `ImportError: os` | "Security Violation: Access to 'os' module is restricted in this profile." |
| `SIGSYS` | Blocked `socket()` | "Action Denied: Your code attempted to open a network connection. Only local processing is allowed." |
| `OOM Killed` | Memory Limit | "Resource Exhausted: The process exceeded 128MB RAM. Optimize your memory usage or request a higher tier." |

---

## 6. Security Model & Profiles

SentinelBox supports pre-defined security templates with dynamic permission negotiation:

*   **Strict (Default)**: No network, immutable filesystem, whitelist of essential syscalls.
*   **Data Science**: Limited network (whitelisted PyPI), high memory limit, Read-Only data access.
*   **Web Agent**: Restricted HTTP access, browser-specific syscall whitelist.

---

## 7. System Requirements

*   **OS**: Linux Kernel 5.15+ (Required for Cgroup v2 and User Notification optimizations).
*   **Permissions**: Designed for **Rootless** operation via User Namespaces.
*   **Dependencies**: `libseccomp`, `pkg-config`, `python 3.10+`, `busybox` (base rootfs).

---

## 8. Roadmap & Progress

| Phase | Milestone | Core Technologies | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Container Primitives | C, Linux Namespaces, pivot_root, OverlayFS, Cgroup v2, libcap | Completed |
| **Phase 2** | Security Sentinel | Rust, Seccomp UserNotif, SCM_RIGHTS fd passing | Completed |
| **Phase 3** | Telemetry & Database | Rust, cgroup v2 sampling, SQLite WAL audit | Completed |
| **Phase 4** | MCP Integration | Async SDK, TypeScript, Self-Repair Loop | Completed |
| **Phase 5** | Management UI | React, Tailwind, Socket.io Real-time Bridge | Completed |

---

## 9. Getting Started & Complete Startup Guide

SentinelBox is a multi-layered system. To experience the full features (including semantic feedback and real-time visualization), follow this sequence to start the services.

### 9.1 Step 1: Environment Initialization
Whether you are on a native Linux host or in a Docker environment, you first need to compile the Core engine (C) and the Security Sentinel (Rust).
```bash
bash scripts/provision.sh
```
*(This script automatically installs dependencies, compiles the code, and sets up a lightweight busybox rootfs.)*

### 9.2 Step 2: Start the Monitoring Panel (Dashboard & Bridge)
Before running the sandbox, start the data bridge and the React dashboard to receive real-time metrics.
We provide a one-click startup script:
```bash
./scripts/start_monitoring.sh
```
Once started, visit `http://localhost:3000` in your browser.
*(This script runs the Node.js Bridge (Port 3001) and Vite Dev Server (Port 3000) in the background and automatically connects to the SQLite database. If ports are occupied, the script attempts to clean up ghost processes.)*

### 9.3 Step 3: Execute the Sandbox (Generate Real Data)
Open **another new terminal window** and run the following commands to trigger sandbox execution and observe real-time changes on the dashboard:

*   **Generate High CPU Load (Test Chart Spikes)**:
    ```bash
    bash scripts/run.sh -- /bin/sh -c "while true; do let x=1+1; done"
    ```
*   **Trigger Network Security Violation (Test Semantic Interception)**:
    ```bash
    bash scripts/run.sh -- /bin/sh -c "nc -w1 google.com 80"
    ```

---

## 10. Environmental Differences & Troubleshooting

SentinelBox deeply relies on low-level Linux Kernel mechanisms. When running in different environments, you may encounter various permission restrictions. These are **not system bugs, but normal protection mechanisms of the operating system architecture**.

### ⚠️ Common Error 1: Cgroup Creation Failed / Permission denied
When running `run.sh`, you might see the following warning:
> `[ERR] Failed to create cgroup /sys/fs/cgroup/sentinelbox.XXXX: Read-only file system` (or Permission denied)
> `[WARN] Cgroup creation failed, continuing without resource limits`

*   **Cause**: If you are running in **Docker containers, VS Code Dev Containers, or certain WSL2 configurations**, the system defaults to "locking" the host's Cgroup tree, preventing unprivileged applications within the container from creating their own resource control groups (Cgroup v2 Delegation failure).
*   **System Response (Automatic Fallback)**: SentinelBox features a robust **Graceful Degradation mechanism**. When the underlying Rust Monitor detects that it cannot read sandboxed Cgroup data, it **automatically falls back to reading global system resources** (`/proc/stat` and `/proc/meminfo`). Therefore, even with this warning, your Dashboard will still show data spikes, though it will reflect the "whole machine" load rather than "sandbox-specific" load.
*   **How to Truly Resolve (Obtain Precise Sandbox Limits)**:
    *   **Solution A (Fastest)**: On a native Linux host, use `sudo` to run the sandbox:
        `sudo bash scripts/run.sh -- /bin/sh -c "echo hello"`
    *   **Solution B (Rootless)**: On a native Linux host, run `sudo bash scripts/setup_cgroup.sh` to complete systemd user delegation.

### ⚠️ Common Error 2: database disk image is malformed
*   **Cause**: The system uses SQLite's WAL (Write-Ahead Logging) mode to support high-concurrency read/writes. If you write from a Docker container while reading from the host via Node.js and forcefully terminate (Kill -9) certain processes, the WAL index file might become corrupted.
*   **Solution**: Close the monitoring scripts, delete the database, and let the system rebuild it.
    ```bash
    rm sentinelbox.db sentinelbox.db-shm sentinelbox.db-wal
    ```

### ⚠️ Common Error 3: Port 3000/3001 Address already in use
*   **Cause**: The previous monitoring panel was not closed properly (possibly stuck in the background).
*   **Solution**: `start_monitoring.sh` has built-in cleanup mechanisms. If it remains stuck, manually run `pkill -f "vite"` and `pkill -f "node src/index.js"`.

---

## 11. Required Project Deliverables
To comply with the UNIX System Programming course requirements, the following documents are maintained:
*   **`docs/Final_Report.tex`**: Comprehensive 20+ page LaTeX final report analyzing architecture, implementation, and telemetry fallbacks.
*   **`CONTRIBUTING.md`**: Contribution guidelines, development environment setup, and coding standards.
*   **`man` page**: Technical manual accessible via `man ./docs/sentinelbox.1` covering command-line options and security profiles.
