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
| **Phase 1** | Container Primitives | C, Linux Namespaces, pivot_root, OverlayFS, Cgroup v2, libcap | Completed |
| **Phase 2** | Security Sentinel | Rust, Seccomp UserNotif, SCM_RIGHTS fd passing | Completed |
| **Phase 3** | Telemetry & Database | Rust, cgroup v2 sampling, SQLite WAL audit | Completed |
| **Phase 4** | MCP Integration | Async SDK, TypeScript, Self-Repair Loop | Completed |
| **Phase 5** | Management UI | React, Tailwind, Socket.io Real-time Bridge | Completed |

---

## 8. Getting Started & Complete Startup Guide

SentinelBox 是一個多層架構系統。要獲得完整的體驗（包含語意回饋與視覺化即時圖表），請遵循以下順序啟動服務。

### 8.1 步驟一：環境初始化
無論您是在實體 Linux 或 Docker 環境，首先都需要編譯核心引擎 (C) 與安全哨兵 (Rust)。
```bash
bash scripts/provision.sh
```
*(此腳本會自動安裝依賴、編譯並建立輕量級的 busybox rootfs。)*

### 8.2 步驟二：啟動即時監控面板 (Dashboard & Bridge)
在執行沙盒之前，請先啟動資料橋接器與前端 React 面板，以便接收即時數據。
我們提供了一鍵啟動腳本：
```bash
./start_monitoring.sh
```
啟動後，請開啟瀏覽器訪問 `http://localhost:3000`。
*(此腳本會在背景同時執行 Node.js Bridge (Port 3001) 與 Vite Dev Server (Port 3000)，並自動連接 SQLite 資料庫。若遇到 Port 被佔用，腳本會嘗試自動清理僵屍進程。)*

### 8.3 步驟三：執行沙盒 (生成真實數據)
請開啟**另一個全新的終端機視窗**，執行以下指令以觸發沙盒執行，並觀察網頁面板的即時變化：

*   **產生高 CPU 負載（測試圖表跳動）**：
    ```bash
    bash scripts/run.sh -- /bin/sh -c "while true; do let x=1+1; done"
    ```
*   **觸發網路安全違規（測試語意攔截）**：
    ```bash
    bash scripts/run.sh -- /bin/sh -c "nc -w1 google.com 80"
    ```

---

## 9. 環境差異與常見問題排解 (Troubleshooting)

SentinelBox 深度依賴 Linux Kernel 的底層機制。您在不同環境下執行時，會遇到不同的權限限制，這**並非系統 Bug，而是作業系統架構的正常保護機制**。

### ⚠️ 常見錯誤 1：Cgroup 建立失敗 / Permission denied
當您執行 `run.sh` 時，可能會看到以下警告：
> `[ERR] 建立 cgroup 失敗 /sys/fs/cgroup/sentinelbox.XXXX: Read-only file system` (或 Permission denied)
> `[WARN] cgroup 建立失敗，繼續執行但無資源限制`

*   **發生原因**：如果您是在 **Docker 容器、VS Code Dev Containers、或某些 WSL2 設定下**執行，系統預設會「鎖死」宿主機的 Cgroup 樹，禁止容器內部的普通應用程式私自建立資源控制群組 (Cgroup v2 Delegation 失敗)。
*   **系統應對方式 (自動 Fallback)**：SentinelBox 具備強健的**優雅降級 (Graceful Degradation) 機制**。當底層 Rust Monitor 發現無法讀取專屬的沙盒 Cgroup 數據時，它會**自動 Fallback 去讀取宿主機的全域系統資源**（`/proc/stat` 與 `/proc/meminfo`）。因此，即便出現此警告，您的 Dashboard 依然會有數據跳動，只是顯示的會是「整台機器」的負載，而非「沙盒專屬」的負載。
*   **如何真正解決 (獲得精準沙盒限制)**：
    *   **解法 A (最快)**：在原生 Linux 機構下，直接使用 `sudo` 執行沙盒：
        `sudo bash scripts/run.sh -- /bin/sh -c "echo hello"`
    *   **解法 B (Rootless)**：在原生 Linux 機構下，執行 `sudo bash scripts/setup_cgroup.sh` 完成 systemd user delegation。

### ⚠️ 常見錯誤 2：database disk image is malformed
*   **發生原因**：系統使用 SQLite 的 WAL (Write-Ahead Logging) 模式以支援高併發讀寫。如果您在 Docker 容器內寫入，同時在宿主機用 Node.js 讀取，且強制中斷（Kill -9）了某些進程，可能會導致 WAL 索引檔損毀。
*   **解法**：關閉監控腳本，直接刪除資料庫，讓系統重建。
    ```bash
    rm sentinelbox.db sentinelbox.db-shm sentinelbox.db-wal
    ```

### ⚠️ 常見錯誤 3：Port 3000/3001 Address already in use
*   **發生原因**：之前的監控面板沒有被正常關閉（可能卡在背景）。
*   **解法**：`start_monitoring.sh` 已內建清理機制。若仍卡住，可手動執行 `pkill -f "vite"` 與 `pkill -f "node index.js"`。

---

## 10. Required Project Deliverables
To comply with the UNIX System Programming course requirements, the following documents are maintained:
*   **`docs/Final_Report.tex`**: Comprehensive 20+ page LaTeX final report analyzing architecture, implementation, and telemetry fallbacks.
*   **`CONTRIBUTING.md`**: Contribution guidelines, development environment setup, and coding standards.
*   **`man` page**: Technical manual accessible via `man ./docs/sentinelbox.1` covering command-line options and security profiles.
