-- SentinelBox audit log 結構 v1
-- 採 SQLite，啟用 WAL 模式以支援 monitor / MCP server / dashboard API 並行讀寫。
--
-- 約定：
--   - 所有 ts 欄位一律為 UNIX epoch 毫秒（ms）。高頻取樣（10Hz）需要毫秒精度做圖表。
--   - 數值一律存「原始值」，顯示用換算（bytes→MB 等）交給前端 / MCP。
--   - 欄位完整語義、errno 對照表、範例查詢見 docs/db-schema.md。
--
-- 三張主表：
--   executions       一筆 = 一次沙盒執行
--   syscall_events   一筆 = 一次 seccomp NOTIFY/KILL 事件
--   resource_samples 一筆 = 一次 telemetry 取樣 (cgroup stat)

CREATE TABLE IF NOT EXISTS executions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile     TEXT    NOT NULL,
    pid         INTEGER,                       -- 宿主機 PID
    command     TEXT,                          -- 執行命令 argv[0] ...
    start_ts    INTEGER NOT NULL,              -- UNIX epoch (ms)
    end_ts      INTEGER,                       -- NULL 表尚未結束（= 進行中的沙盒）
    status      TEXT                           -- completed / killed / error
);

CREATE TABLE IF NOT EXISTS syscall_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    exec_id      INTEGER NOT NULL REFERENCES executions(id),
    ts           INTEGER NOT NULL,             -- UNIX epoch (ms)
    pid          INTEGER,
    syscall_nr   INTEGER,                       -- syscall 編號（x86_64）
    syscall_name TEXT,                          -- 例 socket / connect / ptrace
    action       TEXT,                          -- ALLOW / ERRNO / NOTIFY / KILL
    errno        INTEGER,                       -- 原始 errno 數字（對照見 docs/db-schema.md）
    signal_name  TEXT,                          -- errno/signal 符號名：EPERM / EACCES / SIGKILL / OK
    path         TEXT,                          -- 受影響路徑（目前保留欄位，尚未填值）
    semantic_msg TEXT                           -- Rust live-loop 英文訊息；UI 翻譯由 MCP 負責
);

CREATE TABLE IF NOT EXISTS resource_samples (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    exec_id   INTEGER NOT NULL REFERENCES executions(id),
    ts        INTEGER NOT NULL,                 -- UNIX epoch (ms)
    mem_bytes INTEGER,                          -- 原始 bytes（顯示 MB = /1024/1024，前端換算）
    cpu_usec  INTEGER,                          -- cgroup 累積 CPU 微秒（raw 單調遞增）
    cpu_pct   REAL                              -- 該取樣區間 CPU 使用率 %（Rust 已算好；多核可 >100）
);

CREATE INDEX IF NOT EXISTS idx_syscall_exec  ON syscall_events(exec_id);
CREATE INDEX IF NOT EXISTS idx_resource_exec ON resource_samples(exec_id);
CREATE INDEX IF NOT EXISTS idx_exec_start    ON executions(start_ts);
