//! db.rs - SQLite WAL audit log
//!
//! 為什麼啟用 WAL：
//!   - WAL (Write-Ahead Logging) 允許讀寫並行；monitor 寫入 syscall events 時，
//!     未來 MCP server 或 UI 可以同時查詢歷史紀錄而不互鎖。
//!   - 對應 README §2.3 規範「Database Integration (WAL Mode)」。
//!
//! Schema：見 migrations/001_init.sql。
//! 此檔提供 thin wrapper：
//!   - `open()` 開啟並 ensure schema 已 migrate
//!   - `record_execution_start / end`
//!   - `record_syscall_event`
//!   - `record_resource_sample`（給 telemetry 呼叫）

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// 取得目前 UNIX epoch 秒
fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

const SCHEMA_SQL: &str = include_str!("../migrations/001_init.sql");

/// 包一層 Connection 提供高階 API
pub struct AuditDb {
    conn: Connection,
}

impl AuditDb {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("無法開啟 SQLite: {}", path.display()))?;

        // WAL 開啟 — 用 PRAGMA 而非 schema 建構式內 PRAGMA，
        // 因為 PRAGMA journal_mode 在 schema migration 前下才會生效
        conn.pragma_update(None, "journal_mode", "WAL")
            .context("PRAGMA journal_mode=WAL 失敗")?;
        // 同步等級設 NORMAL 在 WAL 模式下足夠安全且效能高
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // 防止單一交易卡住其它讀者
        conn.pragma_update(None, "busy_timeout", "5000")?;

        // 套用 schema（IF NOT EXISTS 故 idempotent）
        conn.execute_batch(SCHEMA_SQL).context("套用 schema 失敗")?;

        Ok(Self { conn })
    }

    /// 開始一次執行；回傳 exec_id 給後續事件 / sample 標籤
    pub fn record_execution_start(&mut self, profile: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO executions (profile, start_ts) VALUES (?, ?)",
            params![profile, now_ts()],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn record_execution_end(&mut self, exec_id: i64, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE executions SET end_ts = ?, status = ? WHERE id = ?",
            params![now_ts(), status, exec_id],
        )?;
        Ok(())
    }

    pub fn record_syscall_event(
        &mut self,
        exec_id: i64,
        pid: i64,
        syscall_nr: i32,
        syscall_name: &str,
        action: &str,
        errno: i32,
        semantic_msg: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO syscall_events (exec_id, ts, pid, syscall_nr, syscall_name, action, errno, semantic_msg)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![exec_id, now_ts(), pid, syscall_nr, syscall_name, action, errno, semantic_msg],
        )?;
        Ok(())
    }

    pub fn record_resource_sample(
        &mut self,
        exec_id: i64,
        mem_bytes: u64,
        cpu_usec: u64,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO resource_samples (exec_id, ts, mem_bytes, cpu_usec)
             VALUES (?, ?, ?, ?)",
            params![exec_id, now_ts(), mem_bytes as i64, cpu_usec as i64],
        )?;
        Ok(())
    }
}
