-- SentinelBox audit log 結構 v1
-- 採 SQLite，啟用 WAL 模式以支援 monitor / 未來 MCP server 並行讀寫
--
-- 三張主表：
--   executions       一筆 = 一次沙盒執行
--   syscall_events   一筆 = 一次 seccomp NOTIFY/KILL 事件
--   resource_samples 一筆 = 一次 telemetry 取樣 (cgroup stat)

CREATE TABLE IF NOT EXISTS executions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile     TEXT    NOT NULL,
    start_ts    INTEGER NOT NULL,             -- UNIX epoch (秒)
    end_ts      INTEGER,                       -- NULL 表尚未結束
    status      TEXT                           -- completed / killed / error
);

CREATE TABLE IF NOT EXISTS syscall_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    exec_id      INTEGER NOT NULL REFERENCES executions(id),
    ts           INTEGER NOT NULL,
    pid          INTEGER,
    syscall_nr   INTEGER,
    syscall_name TEXT,
    action       TEXT,                          -- ALLOW / ERRNO / NOTIFY / KILL
    errno        INTEGER,
    semantic_msg TEXT
);

CREATE TABLE IF NOT EXISTS resource_samples (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    exec_id   INTEGER NOT NULL REFERENCES executions(id),
    ts        INTEGER NOT NULL,
    mem_bytes INTEGER,
    cpu_usec  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_syscall_exec  ON syscall_events(exec_id);
CREATE INDEX IF NOT EXISTS idx_resource_exec ON resource_samples(exec_id);
CREATE INDEX IF NOT EXISTS idx_exec_start    ON executions(start_ts);
