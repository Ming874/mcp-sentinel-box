//! ebpf/mod.rs - eBPF probe 載入器（骨架）
//!
//! 設計目標（對應 README §2.2）：
//!   - 用 aya 載入 CO-RE eBPF 程式（probe.bpf.o）
//!   - 將 tracepoint 事件透過 RingBuf 推到 user-space
//!   - user-space 把事件寫進 audit DB / 串流到 UI
//!
//! 目前狀態（Prototype）：
//!   - 為避免在不支援 BTF 的 kernel 上 build 失敗，本模組僅提供 stub。
//!   - 真正啟用 eBPF 時，於 build.rs 加入 `aya-build` 編譯流程，並改用 `Bpf::load`。
//!
//! 進階方向：
//!   1. tracepoint:syscalls:sys_enter_execve 紀錄 sandbox 內每次 execve
//!   2. cgroup_skb 限制 / 統計沙盒網路流量
//!   3. uprobe 對動態語言 runtime 做模組載入 hook

use anyhow::Result;

/// 嘗試載入 eBPF probe。目前回傳 Ok(()) 不做事。
pub fn try_load() -> Result<()> {
    tracing::info!("eBPF probe 載入跳過（prototype 階段未啟用，見 src/ebpf/mod.rs）");
    Ok(())
}
