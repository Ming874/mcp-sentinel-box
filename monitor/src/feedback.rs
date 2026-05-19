//! feedback.rs - 把 kernel 級訊號翻譯成自然語言「Semantic Feedback」
//!
//! 對應 README 第 4 節「The Semantic Feedback Innovation」：
//!   - Exit Code 1 / ImportError    → 「Access to 'os' module is restricted」
//!   - SIGSYS  (blocked syscall)    → 「Code attempted X. Only local processing is allowed.」
//!   - OOM Killed                   → 「Process exceeded N MB RAM. Optimize memory usage.」
//!
//! 本檔目前提供 syscall 拒絕 → 自然語言 + remediation hint 的對照表。
//! 後續 Phase 4 MCP server 可直接消費這個 string。

use crate::policy::Action;
use crate::seccomp::SeccompNotif;

/// 一條 feedback 紀錄。寫到 audit log 與 stderr。
#[derive(Debug, Clone)]
pub struct Feedback {
    pub syscall_name: &'static str,
    pub action_taken: Action,
    pub errno: i32,
    /// 給 LLM 看的 high-level 訊息（中文）。
    pub semantic_zh: String,
    /// 英文版（給 monitor stdout / 報告匯出用）。
    pub semantic_en: String,
    /// 對 AI Agent 的修正建議。
    pub remediation: String,
}

/// 從 SeccompNotif + 決策結果產生 feedback。
pub fn build_feedback(notif: &SeccompNotif, action: Action, errno: i32) -> Feedback {
    let name = crate::seccomp::syscall_name(notif.data.nr);

    // 對特定 syscall 群組做語意映射；未列表者走通用模板。
    let (zh, en, remediation) = match name {
        "socket" | "socketpair" => (
            format!("安全違規：嘗試在 strict profile 內建立 socket（family={}）。",
                    notif.data.args[0]),
            format!("Security Violation: Attempt to create a socket (family={}) in strict profile.",
                    notif.data.args[0]),
            "改用沙盒外預先準備好的資料；本 profile 禁止任何網路連線。".to_string(),
        ),
        "connect" | "sendto" | "sendmsg" => (
            format!("動作拒絕：程式碼嘗試對外連線。"),
            format!("Action Denied: Your code attempted to open a network connection."),
            "請改用本地處理；或切換到允許網路的 profile (datascience / web)。".to_string(),
        ),
        "bind" | "listen" | "accept" | "accept4" => (
            format!("動作拒絕：嘗試開放對外監聽埠。"),
            format!("Action Denied: Inbound listening port is disallowed in this profile."),
            "若需要對外服務，請改用 web profile 並指定允許埠範圍。".to_string(),
        ),
        "ptrace" => (
            "安全違規：偵測到 ptrace 嘗試。".to_string(),
            "Security Violation: ptrace detected.".to_string(),
            "不允許在沙盒內附加除錯器；移除 ptrace/strace 呼叫。".to_string(),
        ),
        "mount" | "umount2" | "pivot_root" | "chroot" | "setns" | "unshare" => (
            format!("動作拒絕：禁止變更檔案系統或 namespace（syscall={name}）。"),
            format!("Action Denied: Filesystem/namespace mutation ({name}) is forbidden."),
            "沙盒內 rootfs 為唯讀 overlay；不需要也不允許 remount。".to_string(),
        ),
        "bpf" | "perf_event_open" | "init_module" | "finit_module" | "delete_module" => (
            format!("安全違規：嘗試載入或操作 kernel 元件（{name}）。"),
            format!("Security Violation: Kernel-level operation ({name}) is forbidden."),
            "沙盒不允許接觸 BPF / kernel module；改用 user-space 等效實作。".to_string(),
        ),
        _ => (
            format!("動作拒絕：syscall {name} 在 profile 「strict」內不被允許。"),
            format!("Action Denied: syscall {name} is not allowed in this profile."),
            format!("若必要，請評估是否切換 profile，或避免使用 {name}。"),
        ),
    };

    Feedback {
        syscall_name: name,
        action_taken: action,
        errno,
        semantic_zh: zh,
        semantic_en: en,
        remediation,
    }
}
