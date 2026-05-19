//! telemetry.rs - cgroup v2 取樣執行緒（Phase 3）
//!
//! 每 100 ms 讀一次 memory.current 與 cpu.stat，寫入 SQLite resource_samples。
//!
//! 為什麼直接讀檔而非 eBPF：
//!   - cgroup v2 sysfs 介面開銷極低（單次 ~10us），且 kernel 已維護精確統計。
//!   - 真正高頻 (>10kHz) 事件才需要 eBPF；100Hz 取樣對 monitor 表現面板足夠。
//!   - 之後若要加 eBPF skb / tracepoint 事件，新增模組即可（見 ebpf/ 目錄）。
//!
//! Stop 訊號：由 main thread 透過 AtomicBool 通知；每輪 sleep 結束都會檢查。

use anyhow::{Context, Result};
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use tracing::{debug, warn};

/// 採樣 loop。`cgroup_path` 為 None 時退化為只記空樣本（dev 環境用）。
pub fn run(
    cgroup_path: Option<String>,
    db_path: PathBuf,
    exec_id: i64,
    stop: Arc<AtomicBool>,
) -> Result<()> {
    let mut db = crate::db::AuditDb::open(&db_path)
        .context("telemetry 開啟 audit DB 失敗")?;

    let mut next_tick = Instant::now() + Duration::from_millis(100);
    while !stop.load(Ordering::Relaxed) {
        // sleep until next tick；確保固定 10Hz 取樣，不受 DB 寫入時間漂移
        let now = Instant::now();
        if next_tick > now {
            std::thread::sleep(next_tick - now);
        }
        next_tick += Duration::from_millis(100);

        let (mem, cpu) = match cgroup_path.as_deref() {
            Some(cg) => match read_cgroup(cg) {
                Ok(v) => v,
                Err(e) => {
                    debug!(?e, "cgroup 讀取失敗（可能 sandbox 已結束）");
                    (0, 0)
                }
            },
            None => (0, 0),
        };

        if let Err(e) = db.record_resource_sample(exec_id, mem, cpu) {
            warn!(?e, "resource_sample 寫入失敗");
        }
    }
    Ok(())
}

/// 對外便利 API：一次讀取 (mem_peak, cpu_total_usec)。
/// 給 main 結束時印 summary 用。
pub fn snapshot(cgroup_path: &str) -> Result<(u64, u64)> {
    read_cgroup(cgroup_path)
}

/// 讀 memory.current + cpu.stat
fn read_cgroup(cg: &str) -> Result<(u64, u64)> {
    let mem = read_u64_file(Path::new(cg).join("memory.current"))?;
    let cpu = parse_cpu_stat(&std::fs::read_to_string(Path::new(cg).join("cpu.stat"))?)?;
    Ok((mem, cpu))
}

fn read_u64_file(path: PathBuf) -> Result<u64> {
    let s = std::fs::read_to_string(&path)
        .with_context(|| format!("讀檔失敗 {}", path.display()))?;
    Ok(s.trim().parse::<u64>().unwrap_or(0))
}

/// cpu.stat 範例：
///   usage_usec 12345
///   user_usec 6789
///   system_usec 5556
fn parse_cpu_stat(s: &str) -> Result<u64> {
    for line in s.lines() {
        let mut it = line.split_whitespace();
        if let (Some("usage_usec"), Some(v)) = (it.next(), it.next()) {
            return Ok(v.parse::<u64>().unwrap_or(0));
        }
    }
    Ok(0)
}
