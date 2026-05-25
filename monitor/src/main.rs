//! sentinelbox-monitor 主進入點
//!
//! 部署方式：
//!   - 由 C 主程式 `sentinelbox` 透過 fork+exec 啟動。
//!   - 環境變數帶入：
//!       SENTINELBOX_MONITOR_FD  → 透過 SCM_RIGHTS 取 notify_fd 的 socket fd（通常為 3）
//!       SENTINELBOX_PROFILE     → profile 名稱（strict / datascience / web）
//!       SENTINELBOX_PROFILE_DIR → profile 所在目錄（預設 ./profiles）
//!       SENTINELBOX_CGROUP      → 沙盒所在 cgroup 路徑（telemetry 取樣用）
//!       SENTINELBOX_DB          → audit log SQLite 檔（預設 ./sentinelbox.db）
//!
//! 退出條件：
//!   - notify_fd EOF（sandbox child execve 結束或被殺）
//!   - SIGINT / SIGTERM 由 tokio/nix 處理（本實作採同步 loop，由 errno 判斷）

mod seccomp;
mod policy;
mod feedback;
mod ipc;
mod telemetry;
mod db;
mod ebpf;

use anyhow::{Context, Result};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use tracing::{info, warn, debug, error};

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

fn main() -> Result<()> {
    // Tracing 初始化：預設只顯示 INFO 以上，SENTINELBOX_LOG=debug 可開細節
    let env_filter = tracing_subscriber::EnvFilter::try_from_env("SENTINELBOX_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_target(false)
        .with_writer(std::io::stderr) // 不汙染 stdout
        .init();

    // 1) 讀環境變數
    let sock_fd: i32 = env_or("SENTINELBOX_MONITOR_FD", "3").parse()?;
    let profile_name = env_or("SENTINELBOX_PROFILE", "strict");
    let profile_dir: PathBuf = env_or("SENTINELBOX_PROFILE_DIR", "./profiles").into();
    let cgroup_path: Option<String> = std::env::var("SENTINELBOX_CGROUP").ok();
    let db_path: PathBuf = env_or("SENTINELBOX_DB", "./sentinelbox.db").into();
    let mapping_path: PathBuf = env_or("SENTINELBOX_MAPPINGS",
                                       "./mappings/syscall_feedback.json").into();

    info!(?profile_name, ?profile_dir, ?cgroup_path, "monitor 啟動");

    // 嘗試載入 eBPF probe（Phase 3 預留，目前為 stub）
    let _ = ebpf::try_load();

    // 2) 載入 profile policy
    let policy = policy::Policy::load(&profile_dir, &profile_name)
        .context("無法載入 profile")?;
    info!(rules = policy.rules_by_name.len(), "policy 載入完成");

    // 2b) 載入錯誤碼 → 語義 mapping 邏輯表
    let fbmap = feedback::FeedbackMap::load(&mapping_path)
        .context("無法載入 syscall_feedback 對照表")?;

    // 3) 開啟 SQLite WAL audit log（Arc<Mutex> 讓 telemetry thread 共用同一個 writer）
    let audit = Arc::new(Mutex::new(db::AuditDb::open(&db_path)?));

    // 4) 收 notify_fd 並解析 handshake (格式: "PID:<pid>|CMD:<cmd>")
    let (notify_fd, handshake) = ipc::recv_fd(sock_fd)
        .context("從 sandbox child 取 notify_fd 失敗")?;
    
    let mut child_pid = None;
    let mut child_cmd = None;
    if handshake.starts_with("PID:") {
        if let Some(pipe_idx) = handshake.find('|') {
            let pid_part = &handshake[4..pipe_idx];
            child_pid = pid_part.parse::<i32>().ok();
            if handshake[pipe_idx..].starts_with("|CMD:") {
                child_cmd = Some(&handshake[pipe_idx + 5..]);
            }
        }
    }

    let exec_id = audit.lock().unwrap().record_execution_start(&policy.name, child_pid, child_cmd)?;
    info!(exec_id, ?child_pid, ?child_cmd, "已收到 sandbox child 傳來的 notify_fd 並記錄執行開始");

    // 5) 啟動 telemetry 採樣執行緒（Phase 3）
    let stop_flag = Arc::new(AtomicBool::new(false));
    let telemetry_handle = {
        let stop = Arc::clone(&stop_flag);
        let cg = cgroup_path.clone();
        let audit_for_tele = Arc::clone(&audit);
        let exec_id_for_thread = exec_id;
        std::thread::spawn(move || {
            if let Err(e) = telemetry::run(cg, audit_for_tele, exec_id_for_thread, stop) {
                error!(?e, "telemetry thread 失敗");
            }
        })
    };

    // 6) seccomp notification 事件迴圈
    //
    // 為什麼要先 poll 再 recv：直接 blocking ioctl(RECV) 在「sandbox 沒觸發任何
    // NOTIFY 就結束」（例如 hello 只有 write/execve）時，不一定會被喚醒 → monitor
    // 卡死、parent 等不到它。改用 poll：sandbox 全部行程結束時 kernel 對 listener fd
    // 回 POLLHUP，monitor 即可乾淨退出（seccomp_unotify(2) 行為）。
    info!("進入 seccomp 事件迴圈");
    loop {
        let mut pfd = libc::pollfd { fd: notify_fd, events: libc::POLLIN, revents: 0 };
        let pr = unsafe { libc::poll(&mut pfd as *mut libc::pollfd, 1, 1000) };
        if pr < 0 {
            let e = std::io::Error::last_os_error();
            if e.raw_os_error() == Some(libc::EINTR) { continue; } // 被訊號打斷，重試
            debug!(?e, "poll 失敗，離開事件迴圈");
            break;
        }
        if pr == 0 { continue; } // 1 秒 timeout，回頭再 poll（順便給機會偵測 sandbox 結束）
        if pfd.revents & libc::POLLIN == 0 {
            // 被喚醒卻沒有可讀資料 = POLLHUP/POLLERR/POLLNVAL：
            // filter owner（sandbox 內所有行程）已結束，沒有更多 syscall 會進來。
            debug!(revents = pfd.revents, "notify_fd 掛斷，sandbox 已結束，離開事件迴圈");
            break;
        }

        let notif = match seccomp::recv(notify_fd) {
            Ok(n) => n,
            Err(e) => {
                // notify_fd 在 sandbox 結束後會被 kernel close → ioctl 回 EINTR/ENOENT
                debug!(?e, "notify_fd 收訊結束（推測 sandbox 已退出）");
                break;
            }
        };

        // 查 policy
        let sysname = seccomp::syscall_name(notif.data.nr);
        let (action, errno) = policy.lookup(sysname);
        let fb = fbmap.build(&notif, sysname, &policy.name, action, errno);

        // 原始 errno/signal 符號名（給 MCP 翻譯用的 raw 欄位，非語意翻譯）：
        //   KILL  → 我們先送 EPERM 再 SIGKILL，故記 SIGKILL
        //   ALLOW → 放行不帶 errno，記 OK
        //   其餘  → errno 數字對應的符號（EPERM/EACCES...）
        let signal_name = match action {
            policy::Action::Allow => "OK",
            policy::Action::Kill => "SIGKILL",
            _ => errno_name(errno),
        };

        // 寫 audit log（path 暫填 None：seccomp args 取 path 需讀 /proc/<pid>/mem，後續再補）
        if let Err(e) = audit.lock().unwrap().record_syscall_event(
            exec_id, notif.pid as i64, notif.data.nr, sysname,
            action_to_str(action), errno, signal_name, None, &fb.semantic_en) {
            warn!(?e, "audit insert 失敗");
        }

        // 對外輸出語意 feedback（給 LLM / 操作者看）
        eprintln!("[SEMANTIC] {}", fb.semantic_zh);
        eprintln!("           HINT  → {}", fb.remediation);

        // 回應 kernel
        let resp = match action {
            policy::Action::Allow => seccomp::SeccompNotifResp {
                id: notif.id,
                val: 0,
                error: 0,
                flags: seccomp::SECCOMP_USER_NOTIF_FLAG_CONTINUE,
            },
            policy::Action::Errno => seccomp::SeccompNotifResp {
                id: notif.id, val: -1, error: -errno, flags: 0,
            },
            policy::Action::Notify => {
                // monitor 端的 NOTIFY 視為「拒絕 + 通報」：回 EPERM
                seccomp::SeccompNotifResp {
                    id: notif.id, val: -1,
                    error: -(libc::EPERM),
                    flags: 0,
                }
            }
            policy::Action::Kill => {
                // KILL 路徑：先 send 一個 EPERM 讓 syscall 失敗，
                // 接著 kill target；single-step 操作避免 race
                let r = seccomp::SeccompNotifResp {
                    id: notif.id, val: -1,
                    error: -(libc::EPERM),
                    flags: 0,
                };
                let _ = seccomp::send(notify_fd, &r);
                unsafe { libc::kill(notif.pid as libc::pid_t, libc::SIGKILL); }
                warn!(pid = notif.pid, sysname, "target 已 SIGKILL（KILL action）");
                continue;
            }
        };

        if let Err(e) = seccomp::send(notify_fd, &resp) {
            warn!(?e, "NOTIF_SEND 失敗（target 可能已結束）");
        }
    }

    // 7) 結束程序：通知 telemetry 停止、寫入結束摘要
    stop_flag.store(true, Ordering::Relaxed);
    let _ = telemetry_handle.join();

    audit.lock().unwrap().record_execution_end(exec_id, "completed")?;
    info!(exec_id, "monitor 結束");

    // 給 stdout 一個漂亮的 summary（給人類看）
    if let Some(cg) = cgroup_path.as_ref() {
        let mem_peak = telemetry::read_mem_peak(cg);
        let cpu_us   = telemetry::snapshot(cg).map(|(_, c)| c).unwrap_or(0);
        println!("[monitor] 執行摘要：mem_peak={} KiB  cpu_total={} ms",
            mem_peak / 1024, cpu_us / 1000);
    }

    // 給點時間給 stdout flush
    std::thread::sleep(Duration::from_millis(50));
    Ok(())
}

fn action_to_str(a: policy::Action) -> &'static str {
    match a {
        policy::Action::Allow  => "ALLOW",
        policy::Action::Errno  => "ERRNO",
        policy::Action::Notify => "NOTIFY",
        policy::Action::Kill   => "KILL",
    }
}

/// errno 數字 → 符號名。只列沙盒常見的 errno；其餘回 "UNKNOWN"。
/// 純粹是 raw 欄位（讓 MCP 不必自己背數字），不做任何語意翻譯。
fn errno_name(errno: i32) -> &'static str {
    match errno {
        0 => "OK",
        libc::EPERM => "EPERM",
        libc::ENOENT => "ENOENT",
        libc::EACCES => "EACCES",
        libc::EAGAIN => "EAGAIN",
        libc::ENOMEM => "ENOMEM",
        libc::EFAULT => "EFAULT",
        libc::EBUSY => "EBUSY",
        libc::EEXIST => "EEXIST",
        libc::EINVAL => "EINVAL",
        libc::ENOSYS => "ENOSYS",
        libc::EADDRINUSE => "EADDRINUSE",
        libc::ECONNREFUSED => "ECONNREFUSED",
        libc::ENETUNREACH => "ENETUNREACH",
        libc::EAFNOSUPPORT => "EAFNOSUPPORT",
        _ => "UNKNOWN",
    }
}
