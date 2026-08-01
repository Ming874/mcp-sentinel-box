# Report Materials

報告素材整理區。目前先聚焦 Phase 3（Telemetry & Database，cgroup v2 sampling + SQLite WAL）。

## 目錄

```
materials/
├── README.md              ← 本檔（含 deferred 清單）
├── diagrams/              ← Mermaid 原始碼 + 官方渲染後的 SVG/PNG
│   ├── *.mmd              ← Mermaid source
│   ├── *.svg              ← 由 mermaid.ink 官方服務渲染
│   └── *.png
└── screenshots/           ← 程式碼截圖（freeze 產生）
    └── phase3-*.png
```

## 已產出（Phase 3 範圍）

### Diagrams
| 檔名 | 內容 | 用途 |
| --- | --- | --- |
| `semantic-translation-loop` | AI ↔ Sandbox ↔ Kernel ↔ Monitor ↔ MCP 的 sequence | 整份報告的「故事核心」總覽，放開頭 |
| `phase3-telemetry-dataflow` | cgroup v2 sysfs → telemetry.rs → AuditDb → SQLite WAL → 下游 | Phase 3 章節主圖 |
| `phase3-db-schema` | `executions` / `syscall_events` / `resource_samples` ER 圖 | Phase 3 schema 解說 |

### Code Screenshots
| 檔名 | 對應檔 | 重點 |
| --- | --- | --- |
| `phase3-telemetry-sampling.png` | `monitor/src/telemetry.rs` 取樣迴圈 | 10 Hz cgroup 取樣 + CPU% delta 計算 |
| `phase3-db-wal-setup.png` | `monitor/src/db.rs` `AuditDb::open` | WAL 模式 + PRAGMA 設定 |
| `phase3-db-schema.png` | `monitor/migrations/001_init.sql` | 三張主表 schema |

---

## Deferred（等開發完再做）

下列素材需要可運作的端到端 demo 或穩定數據才有意義，先記著等 Phase 4 / 5 完成再回來補。

### 1. Dashboard 截圖
- 跑 `dashboard/` 真實 UI 畫面（執行列表、syscall timeline、cgroup 資源圖）。
- 比任何架構圖都有說服力，**強烈建議放報告封面或第一個 demo 段落**。

### 2. Demo terminal 錄影 → GIF
- 工具：`asciinema rec` 或 `vhs`（charmbracelet）。
- 腳本：跑 `tests/samples/malicious_network.sh`，呈現「執行 → seccomp 攔下 → monitor 印出語意 feedback → AI 收到字串」整段。
- 輸出：`materials/demos/network-block.gif`（之後補）。

### 3. 效能 / 攔截統計
- 跑全部 `tests/samples/*.sh`，收集：
  - 攔截事件次數 / 種類
  - sandbox 啟動延遲（namespace + overlay + seccomp 安裝）
  - DB row 增量 / 10Hz 取樣實際命中率
- 做成 bar chart（matplotlib / Vega-Lite）。

### 4. 威脅模型對照矩陣
- 三個 profile（`strict` / `web` / `datascience`）各允許/禁止什麼 syscall 與資源上限。
- 表格形式，欄=profile，列=syscall 類別 / cgroup 限制。

### 5. 技術選型比較
- SentinelBox vs Docker vs gVisor vs Firecracker。
- 維度：隔離強度、啟動時間、語意回饋能力、AI agent 友善度、kernel 依賴。
- 適合 radar chart 或一張對照表。

### 6. 其他 Phase 的 Diagrams（緩做）
- Sandbox 啟動流程（main.c → namespace/cgroup/seccomp/overlayfs 呼叫鏈）
- Policy / Profile 決策樹（profile.c + monitor/policy.rs）
- Deployment topology（docker-compose 服務 + volume + cgroup mount）

### 7. 其他 Phase 的 Code Screenshots（緩做）
- `core/src/seccomp.c` BPF filter 安裝
- `core/src/namespace.c` `unshare(CLONE_NEW...)` flag 組
- `monitor/src/seccomp.rs` SIGSYS → syscall name 解析
- `monitor/src/feedback.rs` + `mappings/syscall_feedback.json` **before/after 對照**（"raw syscall 41" → "Network access denied"）— 最能展示「語意翻譯」價值
- `profiles/strict.json` 完整 profile（宣告式策略示範）
- `mcp-server/src/index.ts` tool 註冊段

---

## 重新渲染 / 補做

Mermaid → SVG/PNG（用官方 mermaid.ink 服務，免本機裝 puppeteer）：

```bash
# 在 materials/diagrams/ 下
./render.sh <name>.mmd     # 同名 .svg + .png
```

Code screenshot（freeze → SVG → rsvg-convert → PNG，繞過 freeze chromium 找不到 CJK 字型問題）：

```bash
# materials/screenshots/shoot.sh <lang> <start>,<end> <src> <out-name>
./materials/screenshots/shoot.sh rust 23,80 monitor/src/telemetry.rs phase3-telemetry-sampling
```

依賴：`freeze` (charmbracelet) + `librsvg2-bin` + 系統安裝 `Sarasa Fixed TC` 作 CJK fallback。
