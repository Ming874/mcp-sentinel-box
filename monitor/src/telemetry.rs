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
use tracing::warn;

/// 採樣 loop。cgroup_path 為 None 時退化為只記空樣本（dev 環境用）。
/// db 由 main thread 傳入，兩邊共用同一個 SQLite connection（Mutex 保護）。
use std::io::{Read, Seek, SeekFrom};

pub fn run(
    cgroup_path: Option<String>,
    db: Arc<Mutex<crate::db::AuditDb>>,
    exec_id: i64,
    stop: Arc<AtomicBool>,
) -> Result<()> {
    let mut next_tick = Instant::now() + Duration::from_millis(100);
    
    // 追蹤上一次的取樣數據以計算增量
    let mut prev_cgroup_cpu: Option<u64> = None;
    let mut prev_sys_cpu: Option<(u64, u64)> = None; // (active, total)
    let mut prev_instant = Instant::now();

    // 核心數：用於 cgroup 數據正規化
    let num_cores = std::thread::available_parallelism()
        .map(|n| n.get() as f64)
        .unwrap_or(1.0);

    // 預先開啟 cgroup 檔案以減少系統呼叫開銷
    let mut mem_file = cgroup_path.as_ref().and_then(|cg| {
        std::fs::File::open(Path::new(cg).join("memory.current")).ok()
    });
    let mut cpu_file = cgroup_path.as_ref().and_then(|cg| {
        std::fs::File::open(Path::new(cg).join("cpu.stat")).ok()
    });

    let mut buf = String::with_capacity(256);

    while !stop.load(Ordering::Relaxed) {
        let now = Instant::now();
        if next_tick > now {
            std::thread::sleep(next_tick - now);
        }
        next_tick += Duration::from_millis(100);

        let sample_instant = Instant::now();
        let elapsed_us = sample_instant.duration_since(prev_instant).as_micros() as f64;
        
        // 1. 嘗試讀取 cgroup 數據 (Sandbox 專屬)
        let mut mem_bytes = 0;
        let mut cpu_pct = 0.0;
        let mut current_cgroup_cpu = 0;

        let mut cgroup_success = false;
        
        // 讀取記憶體
        if let Some(ref mut f) = mem_file {
            buf.clear();
            if f.seek(SeekFrom::Start(0)).is_ok() && f.read_to_string(&mut buf).is_ok() {
                if let Ok(m) = buf.trim().parse::<u64>() {
                    mem_bytes = m;
                    cgroup_success = true;
                }
            }
        }

        // 讀取 CPU
        if let Some(ref mut f) = cpu_file {
            buf.clear();
            if f.seek(SeekFrom::Start(0)).is_ok() && f.read_to_string(&mut buf).is_ok() {
                if let Ok(c) = parse_cpu_stat(&buf) {
                    current_cgroup_cpu = c;
                    if let Some(prev_c) = prev_cgroup_cpu {
                        if elapsed_us > 0.0 {
                            cpu_pct = (c.saturating_sub(prev_c) as f64) / elapsed_us * 100.0;
                        }
                    }
                    prev_cgroup_cpu = Some(c);
                } else {
                    cgroup_success = false;
                }
            } else {
                cgroup_success = false;
            }
        }

        // 2. 若 cgroup 失敗，不應該回傳系統全域記憶體 (會誤導使用者以為沙盒用了好幾 GB)
        // 在 Fallback 模式下，我們寧可回傳 0 或從 /proc/stat 估算
        if !cgroup_success {
            mem_bytes = 0; // 改為 0，避免顯示系統 3.4GB 負載
            if let Ok((active, total)) = parse_sys_stat() {
                if let Some((p_active, p_total)) = prev_sys_cpu {
                    let d_active = active.saturating_sub(p_active) as f64;
                    let d_total = total.saturating_sub(p_total) as f64;
                    if d_total > 0.0 {
                        cpu_pct = (d_active / d_total) * 100.0 * num_cores;
                    }
                }
                prev_sys_cpu = Some((active, total));
            }
        }

        prev_instant = sample_instant;

        // 寫入資料庫
        if let Err(e) = db.lock().unwrap().record_resource_sample(exec_id, mem_bytes, current_cgroup_cpu, cpu_pct) {
            warn!(?e, "resource_sample 寫入失敗");
        }
    }
    Ok(())
}

/// 對外便利 API：一次讀取 (mem_current_bytes, cpu_total_usec)。
/// 給 main 結束時印 summary 用。
pub fn snapshot(cgroup_path: &str) -> Result<(u64, u64)> {
    let mem = read_u64_file(Path::new(cgroup_path).join("memory.current"))?;
    let cpu = read_cgroup_cpu(cgroup_path)?;
    Ok((mem, cpu))
}

/// 讀 memory.peak（kernel >= 5.19）；不存在時 fallback 讀 memory.current。
pub fn read_mem_peak(cg: &str) -> u64 {
    let peak_path = PathBuf::from(cg).join("memory.peak");
    let curr_path = PathBuf::from(cg).join("memory.current");
    read_u64_file(peak_path)
        .or_else(|_| read_u64_file(curr_path))
        .unwrap_or(0)
}

/// 僅讀取 cgroup CPU 使用量 (microseconds)
fn read_cgroup_cpu(cg: &str) -> Result<u64> {
    let s = std::fs::read_to_string(Path::new(cg).join("cpu.stat"))?;
    parse_cpu_stat(&s)
}

fn parse_sys_stat() -> Result<(u64, u64)> {
    let s = std::fs::read_to_string("/proc/stat")?;
    if let Some(line) = s.lines().next() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 8 && parts[0] == "cpu" {
            let user: u64 = parts[1].parse().unwrap_or(0);
            let nice: u64 = parts[2].parse().unwrap_or(0);
            let system: u64 = parts[3].parse().unwrap_or(0);
            let idle: u64 = parts[4].parse().unwrap_or(0);
            let iowait: u64 = parts[5].parse().unwrap_or(0);
            let irq: u64 = parts[6].parse().unwrap_or(0);
            let softirq: u64 = parts[7].parse().unwrap_or(0);
            let steal: u64 = parts.get(8).and_then(|v| v.parse().ok()).unwrap_or(0);
            
            let active = user + nice + system + irq + softirq + steal;
            let total = active + idle + iowait;
            return Ok((active, total));
        }
    }
    Err(anyhow::anyhow!("無法解析 /proc/stat"))
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
    Err(anyhow::anyhow!("找不到 usage_usec"))
}
