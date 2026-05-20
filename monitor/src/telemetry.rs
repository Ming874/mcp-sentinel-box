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
//!
//! 注意：db 以 Arc<Mutex<AuditDb>> 共享給 main thread，避免 SQLite 多個 writer 競爭。

use anyhow::{Context, Result};
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use tracing::{debug, warn};

/// 採樣 loop。`cgroup_path` 為 None 時退化為只記空樣本（dev 環境用）。
/// db 由 main thread 傳入，兩邊共用同一個 SQLite connection（Mutex 保護）。
pub fn run(
    cgroup_path: Option<String>,
    db: Arc<Mutex<crate::db::AuditDb>>,
    exec_id: i64,
    stop: Arc<AtomicBool>,
) -> Result<()> {
    let mut next_tick = Instant::now() + Duration::from_millis(100);
    // 算 CPU% 需要兩次取樣的差：cgroup cpu.stat 給的是「累積」微秒，
    // 故記住上一輪的 cpu_usec 與當下時刻，本輪用 delta_cpu / delta_time 算佔比。
    let mut prev_cpu_usec: Option<u64> = None;
    let mut prev_instant = Instant::now();
    // 核心數：cpu_pct 要除以核心數才是「佔整台機器」的比例。
    // 例：12 核用滿 3 核 → 300% / 12 = 25%。取不到時退化為 1（即 per-core 加總值）。
    let num_cores = std::thread::available_parallelism()
        .map(|n| n.get() as f64)
        .unwrap_or(1.0);
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

        // 區間 CPU 使用率 = 期間 CPU 微秒增量 / 實際經過時間 / 核心數 * 100。
        // 除以核心數後是「佔整台機器」的比例，範圍 0~100（全核滿載才接近 100）。
        let sample_instant = Instant::now();
        let cpu_pct = match prev_cpu_usec {
            Some(prev) => {
                let elapsed_us = sample_instant.duration_since(prev_instant).as_micros() as f64;
                if elapsed_us > 0.0 {
                    (cpu.saturating_sub(prev) as f64) / elapsed_us / num_cores * 100.0
                } else {
                    0.0
                }
            }
            None => 0.0, // 第一筆沒有前值可比，記 0
        };
        prev_cpu_usec = Some(cpu);
        prev_instant = sample_instant;

        if let Err(e) = db.lock().unwrap().record_resource_sample(exec_id, mem, cpu, cpu_pct) {
            warn!(?e, "resource_sample 寫入失敗");
        }
    }
    Ok(())
}

/// 對外便利 API：一次讀取 (mem_current_bytes, cpu_total_usec)。
/// 給 main 結束時印 summary 用。
pub fn snapshot(cgroup_path: &str) -> Result<(u64, u64)> {
    read_cgroup(cgroup_path)
}

/// 讀 memory.peak（kernel ≥ 5.19）；不存在時 fallback 讀 memory.current。
pub fn read_mem_peak(cg: &str) -> u64 {
    let peak_path = PathBuf::from(cg).join("memory.peak");
    let curr_path = PathBuf::from(cg).join("memory.current");
    read_u64_file(peak_path)
        .or_else(|_| read_u64_file(curr_path))
        .unwrap_or(0)
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
