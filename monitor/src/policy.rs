//! policy.rs - 載入 profile JSON 並回答「對某個 syscall 該做什麼」
//!
//! 這份檔案是 monitor 端的「決策中心」。對 kernel 從 notify_fd 推來的每一筆通知，
//! 我們會依 profile 規則回應：放行 / 回 errno / 殺掉 target。
//!
//! Profile schema 與 C 端 (core/src/profile.c) 完全相同；
//! 兩端共用 profiles/*.json，確保語意一致。

use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

/// 對應 sb_action_t（C 端枚舉）。Rust 端只用到 ALLOW/ERRNO/KILL，
/// NOTIFY 在 monitor 端已經是「正在被處理」，不會再次出現。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Action {
    Allow,
    Errno,
    Notify,
    Kill,
}

#[derive(Debug, Deserialize)]
struct RuleRaw {
    name: String,
    action: Action,
    #[serde(default = "default_errno")]
    errno: i32,
}
fn default_errno() -> i32 { 1 /* EPERM */ }

#[derive(Debug, Deserialize)]
struct ResourcesRaw {
    #[serde(default)]
    mem_limit_bytes: u64,
    #[serde(default)]
    cpu_max_quota: u64,
    #[serde(default)]
    cpu_max_period: u64,
    #[serde(default)]
    pids_max: u32,
}

#[derive(Debug, Deserialize)]
struct NetworkRaw {
    #[serde(default)]
    allow: bool,
    #[serde(default)]
    allow_dns: bool,
}

#[derive(Debug, Deserialize)]
struct ProfileRaw {
    name: String,
    #[serde(default)]
    description: String,
    default_action: Action,
    #[serde(default)]
    syscall_rules: Vec<RuleRaw>,
    #[serde(default)]
    resources: Option<ResourcesRaw>,
    #[serde(default)]
    network: Option<NetworkRaw>,
}

/// 解析後的 profile：以 HashMap<syscall_name, (action, errno)> 為主索引。
/// 為了能用 syscall 號碼快速查表，我們會再以名稱對應 nr 來反查。
pub struct Policy {
    pub name: String,
    pub description: String,
    pub default_action: Action,
    /// syscall_name → (action, errno)。monitor 接到通知時，
    /// 先用 seccomp::syscall_name(nr) 拿到名稱，再來查表。
    pub rules_by_name: HashMap<String, (Action, i32)>,
    pub mem_limit_bytes: u64,
    pub cpu_max_quota: u64,
    pub cpu_max_period: u64,
    pub pids_max: u32,
    pub allow_network: bool,
    pub allow_dns: bool,
}

impl Policy {
    pub fn load(profile_dir: &Path, name: &str) -> Result<Self> {
        let path = profile_dir.join(format!("{name}.json"));
        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("讀取 profile 失敗: {}", path.display()))?;
        let p: ProfileRaw = serde_json::from_str(&raw)
            .with_context(|| format!("解析 profile JSON 失敗: {}", path.display()))?;

        let mut rules_by_name = HashMap::new();
        for r in p.syscall_rules {
            // 同名重複以最後一筆為準（容錯，方便 profile 疊加）
            rules_by_name.insert(r.name, (r.action, r.errno));
        }
        let res = p.resources.unwrap_or(ResourcesRaw {
            mem_limit_bytes: 128 * 1024 * 1024,
            cpu_max_quota: 50_000,
            cpu_max_period: 100_000,
            pids_max: 32,
        });
        let net = p.network.unwrap_or(NetworkRaw { allow: false, allow_dns: false });

        Ok(Self {
            name: p.name,
            description: p.description,
            default_action: p.default_action,
            rules_by_name,
            mem_limit_bytes: res.mem_limit_bytes,
            cpu_max_quota: res.cpu_max_quota,
            cpu_max_period: res.cpu_max_period,
            pids_max: res.pids_max,
            allow_network: net.allow,
            allow_dns: net.allow_dns,
        })
    }

    /// 查詢 syscall_name 該怎麼處理；若無明列，回 default_action + EPERM。
    pub fn lookup(&self, syscall_name: &str) -> (Action, i32) {
        if let Some(&(a, e)) = self.rules_by_name.get(syscall_name) {
            (a, e)
        } else {
            (self.default_action, libc::EPERM)
        }
    }
}
