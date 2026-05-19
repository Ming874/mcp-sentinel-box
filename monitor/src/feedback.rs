//! feedback.rs - 把 kernel 級訊號翻譯成自然語言「Semantic Feedback」
//!
//! 提案書 §4 字面要求「定義底層錯誤碼至語義的 Mapping 邏輯表」。
//! 對照表本身放在 mappings/syscall_feedback.json，本檔負責：
//!   1. monitor 啟動時把 JSON load 進 `FeedbackMap`。
//!   2. 每個 seccomp NOTIFY 事件查表，做變數展開（{name}/{profile}/{arg0..arg5}），
//!      回傳 `Feedback` 結構供 main 寫 audit + 印 stderr。
//!
//! 新增 syscall 群組不用改 Rust code，只要編輯 JSON 重啟 monitor 即可。

use crate::policy::Action;
use crate::seccomp::SeccompNotif;

use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

/// 一條 feedback 紀錄。寫到 audit log 與 stderr。
#[derive(Debug, Clone)]
pub struct Feedback {
    pub syscall_name: &'static str,
    pub action_taken: Action,
    pub errno: i32,
    /// 給 LLM / 操作者看的中文 high-level 訊息
    pub semantic_zh: String,
    /// 英文版（給 monitor stdout / 報告匯出用）
    pub semantic_en: String,
    /// 對 AI Agent 的修正建議
    pub remediation: String,
}

/// JSON 單一項目（default 或 group 內部）
#[derive(Debug, Clone, Deserialize)]
struct EntryRaw {
    zh: String,
    en: String,
    hint: String,
}

/// JSON 內單一 group
#[derive(Debug, Deserialize)]
struct GroupRaw {
    syscalls: Vec<String>,
    zh: String,
    en: String,
    hint: String,
}

/// JSON 檔頂層
#[derive(Debug, Deserialize)]
struct FileRaw {
    default: EntryRaw,
    #[serde(default)]
    groups: Vec<GroupRaw>,
    // 容許其它欄位（$schema_version、_comment）；serde 預設會忽略未知欄位。
}

/// 載入後的查表結構。`by_name` 是把 groups 攤平的 syscall_name → entry 對應。
pub struct FeedbackMap {
    default: EntryRaw,
    by_name: HashMap<String, EntryRaw>,
}

impl FeedbackMap {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("讀取 mapping 檔失敗: {}", path.display()))?;
        let file: FileRaw = serde_json::from_str(&raw)
            .with_context(|| format!("解析 mapping JSON 失敗: {}", path.display()))?;

        let mut by_name = HashMap::new();
        for g in file.groups {
            let entry = EntryRaw { zh: g.zh, en: g.en, hint: g.hint };
            for name in g.syscalls {
                // 同名重複時以最後一筆為準，方便 profile / override 疊加
                by_name.insert(name, entry.clone());
            }
        }
        tracing::info!(entries = by_name.len(), "feedback mapping 載入完成");
        Ok(Self { default: file.default, by_name })
    }

    /// 給定 syscall_name + notif（為了取 args）+ profile 名稱，回傳完整 Feedback。
    pub fn build(
        &self,
        notif: &SeccompNotif,
        syscall_name: &'static str,
        profile: &str,
        action: Action,
        errno: i32,
    ) -> Feedback {
        let entry = self.by_name.get(syscall_name).unwrap_or(&self.default);
        let expand = |tpl: &str| substitute(tpl, syscall_name, profile, &notif.data.args);
        Feedback {
            syscall_name,
            action_taken: action,
            errno,
            semantic_zh: expand(&entry.zh),
            semantic_en: expand(&entry.en),
            remediation: expand(&entry.hint),
        }
    }
}

/// 簡易模板展開：把 {name}/{profile}/{arg0..arg5} 換成實際值。
/// 不使用 regex 套件以減少相依；7 個 placeholder 直接 str::replace 即可。
fn substitute(tpl: &str, name: &str, profile: &str, args: &[u64; 6]) -> String {
    let mut s = tpl.replace("{name}", name).replace("{profile}", profile);
    for (i, v) in args.iter().enumerate() {
        s = s.replace(&format!("{{arg{i}}}"), &v.to_string());
    }
    s
}
