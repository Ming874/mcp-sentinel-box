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

    info!(?profile_name, ?profile_dir, ?cgroup_path, "monitor 啟動");

    // 嘗試載入 eBPF probe（Phase 3 預留，目前為 stub）
    let _ = ebpf::try_load();

    // 2) 載入 profile policy
    let policy = policy::Policy::load(&profile_dir, &profile_name)
        .context("無法載入 profile")?;
    info!(rules = policy.rules_by_name.len(), "policy 載入完成");

    // 3) 開啟 SQLite WAL audit log（Arc<Mutex> 讓 telemetry thread 共用同一個 writer）
    let audit = Arc::new(Mutex::new(db::AuditDb::open(&db_path)?));
    let exec_id = audit.lock().unwrap().record_execution_start(&policy.name)?;
    info!(exec_id, db = ?db_path, "audit DB 已就緒");

    // 4) 收 notify_fd
    let (notify_fd, hello) = ipc::recv_fd(sock_fd)
        .context("從 sandbox child 取 notify_fd 失敗")?;
    info!(notify_fd, hello, "已收到 sandbox child 傳來的 notify_fd");

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
    info!("進入 seccomp 事件迴圈");
    loop {
        let notif = match seccomp::recv(notify_fd) {
            Ok(n) => n,
            Err(e) => {
                // notify_fd 在 sandbox child 結束後會被 kernel close → ioctl 回 EINTR/ENOENT
                debug!(?e, "notify_fd 收訊結束（推測 sandbox child 已退出）");
                break;
            }
        };

        // 查 policy
        let sysname = seccomp::syscall_name(notif.data.nr);
        let (action, errno) = policy.lookup(sysname);
        let fb = feedback::build_feedback(&notif, action, errno);

        // 寫 audit log
        if let Err(e) = audit.lock().unwrap().record_syscall_event(
            exec_id, notif.pid as i64, notif.data.nr, sysname,
            action_to_str(action), errno, &fb.semantic_en) {
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
