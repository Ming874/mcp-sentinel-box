# SentinelBox Audit DB Schema（給 MCP / Dashboard 開發者）

monitor（Rust）負責把 cgroup / seccomp 撈到的**原始數據**寫進 SQLite。
這份文件說明每張表、每個欄位的意義，讓 MCP server 與 dashboard API 不必看 Rust source 就能讀資料。

## 分工原則

| 工作 | 負責方 |
| :--- | :--- |
| 存原始數據（syscall 事件、資源取樣、執行紀錄） | **monitor (Rust/C)** — 本文件 |
| errno/signal → 自然語言「語意翻譯」 | **MCP server** |
| bytes → MB、ms → 時間字串等顯示換算 | **前端 / API** |

- monitor **不**負責語意翻譯。`semantic_msg` 只是 Rust live-loop 的 best-effort 英文訊息，UI 請以 `errno` + `signal_name` + `syscall_name` + `action` 自行翻譯，避免兩邊措辭不一致。
- DB 一律存**原始值**，不存換算後的單位。

## 通用約定

- **所有 `ts` 欄位皆為 UNIX epoch 毫秒（ms）**，非秒。前端要顯示時間自行 `new Date(ts)`。
- 連線方式：以 read-only 開啟，DB 為 WAL 模式，可與 monitor 並行讀。
  - Node 範例：`new Database(path, { readonly: true })`（better-sqlite3）。
- DB 路徑：env `SENTINELBOX_DB`（Docker 預設 `/var/lib/sentinelbox/audit.db`，原生預設 `./sentinelbox.db`）。

> 註：schema 用 `CREATE TABLE IF NOT EXISTS`。若你手上是舊版 audit.db（缺 `cpu_pct`/`signal_name`/`path` 欄位），請刪掉重建（Docker 把 volume `sentinelbox-data` 清掉即可）。

---

## 表 `executions` — 一次沙盒執行

| 欄位 | 型別 | 說明 |
| :--- | :--- | :--- |
| `id` | INTEGER PK | 執行序號，其他表用 `exec_id` 參照 |
| `profile` | TEXT | profile 名稱：`strict` / `datascience` / `web` |
| `start_ts` | INTEGER | 開始時間（epoch ms） |
| `end_ts` | INTEGER | 結束時間（epoch ms）；**`NULL` = 仍在執行中** |
| `status` | TEXT | `completed` / `killed` / `error` |

**目前進行中的沙盒數（dashboard 的 Active Sandboxes）：**
```sql
SELECT COUNT(*) FROM executions WHERE end_ts IS NULL;
```

---

## 表 `syscall_events` — 一次 seccomp 攔截事件

| 欄位 | 型別 | 說明 |
| :--- | :--- | :--- |
| `id` | INTEGER PK | |
| `exec_id` | INTEGER | 對應 `executions.id` |
| `ts` | INTEGER | 事件時間（epoch ms） |
| `pid` | INTEGER | 觸發的 target PID（global namespace） |
| `syscall_nr` | INTEGER | syscall 編號（x86_64） |
| `syscall_name` | TEXT | 例 `socket` / `connect` / `ptrace`；未知回 `syscall_unknown` |
| `action` | TEXT | monitor 的處置：`ALLOW` / `ERRNO` / `NOTIFY` / `KILL` |
| `errno` | INTEGER | 原始 errno 數字（見下方對照表） |
| `signal_name` | TEXT | errno/signal 符號名：`EPERM` / `EACCES` / `SIGKILL` / `OK` |
| `path` | TEXT | 受影響路徑；**目前一律 `NULL`**（取 path 需讀 `/proc/<pid>/mem`，後續再補） |
| `semantic_msg` | TEXT | Rust 的 best-effort 英文訊息（UI 翻譯請走 MCP，勿直接信任此欄措辭） |

**`action` 語義：**
- `ALLOW` — 放行，syscall 正常執行（通常不需顯示給使用者）
- `ERRNO` — 攔截並回傳指定 errno，讓 syscall 失敗
- `NOTIFY` — 拒絕 + 通報（monitor 回 EPERM）
- `KILL` — 直接終止 target（先回 EPERM 再 SIGKILL）

**dashboard 的 type 對應建議：**
```
action == 'ALLOW'                    → 不顯示
action in ('ERRNO','NOTIFY','KILL')  → 'Violation'
```

**`errno` → `signal_name` 對照表**（monitor 已填好 `signal_name`，此表供查證）：

| errno 值 | signal_name | 意義 |
| :--- | :--- | :--- |
| 0 | `OK` | 放行，無錯誤 |
| 1 | `EPERM` | 權限不足（最常見的攔截結果） |
| 2 | `ENOENT` | 檔案/路徑不存在 |
| 11 | `EAGAIN` | 資源暫時不可用 |
| 12 | `ENOMEM` | 記憶體不足 |
| 13 | `EACCES` | 存取被拒 |
| 14 | `EFAULT` | 位址無效 |
| 16 | `EBUSY` | 資源忙碌 |
| 17 | `EEXIST` | 已存在 |
| 22 | `EINVAL` | 參數無效 |
| 38 | `ENOSYS` | syscall 未實作/被禁 |
| 97 | `EAFNOSUPPORT` | 不支援的位址族（網路被擋常見） |
| 98 | `EADDRINUSE` | 位址已被使用 |
| 101 | `ENETUNREACH` | 網路不可達 |
| 111 | `ECONNREFUSED` | 連線被拒 |
| —（KILL action） | `SIGKILL` | target 被終止 |

> `errno` 出現上表以外的數字時，monitor 會把 `signal_name` 填 `UNKNOWN`，但 `errno` 數字仍保真，MCP 可自行查 `man errno`。

**最近的違規事件（dashboard Security Events）：**
```sql
SELECT ts, syscall_name, action, errno, signal_name, path, semantic_msg
FROM syscall_events
WHERE action != 'ALLOW'
ORDER BY ts DESC
LIMIT 50;
```

---

## 表 `resource_samples` — cgroup 資源取樣（10Hz）

| 欄位 | 型別 | 說明 |
| :--- | :--- | :--- |
| `id` | INTEGER PK | |
| `exec_id` | INTEGER | 對應 `executions.id` |
| `ts` | INTEGER | 取樣時間（epoch ms） |
| `mem_bytes` | INTEGER | cgroup `memory.current`，**原始 bytes** |
| `cpu_usec` | INTEGER | cgroup 累積 CPU 微秒（單調遞增 raw 值） |
| `cpu_pct` | REAL | 該取樣區間 CPU 使用率 %，**已除以核心數**，範圍 0~100（**Rust 已算好，直接用**） |

**換算（前端負責）：**
- 記憶體 MB：`mem_bytes / 1024 / 1024`
- CPU %：直接用 `cpu_pct`，不需再算。
  - `cpu_pct` 是「佔整台機器」的比例：12 核用滿 3 核 → 25%，全核滿載才接近 100。
  - `cpu_usec` 是給需要自算或稽核用的原始累積值（單調遞增、未除核心數），一般顯示不必碰。

**取某次執行的 CPU/記憶體曲線：**
```sql
SELECT ts, mem_bytes, cpu_pct
FROM resource_samples
WHERE exec_id = ?
ORDER BY ts ASC;
```

---

## API server 建議端點（給 dashboard）

| 端點 | 來源 | 備註 |
| :--- | :--- | :--- |
| `GET /api/executions` | `executions` | 列表 + Active 計數 |
| `GET /api/events?exec_id=` | `syscall_events` WHERE action!='ALLOW' | Security Events 面板 |
| `GET /api/metrics?exec_id=` | `resource_samples` | CPU/Memory 圖表 |
| `GET /api/stream` (SSE) | 輪詢上述表的新 `id` | 即時推送，取代前端目前的 mock setInterval |
