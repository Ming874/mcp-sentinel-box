#!/usr/bin/env bash
# tests/test_telemetry.sh - Phase 3 telemetry & DB 端到端測試
#
# 補上 run_tests.sh 缺少的一塊：驗證 cgroup 取樣管線與 SQLite audit log 內容。
# run_tests.sh 只比對 exit code，從不檢查 DB 是否真的寫入資料。
#
# 本測試做什麼：
#   1. 用獨立的暫存 DB（不汙染主 sentinelbox.db）跑一個固定時長（~3s）的負載。
#   2. 用 python3 stdlib sqlite3 查詢 audit log，硬性斷言：
#        - executions 有 1 筆，且 end_ts 已寫入、status=completed
#        - 該 exec 的 resource_samples 筆數 >= 門檻（驗證 10Hz 取樣率）
#        - 至少一筆 mem_bytes > 0（驗證記憶體取樣有效）
#   3. 軟性報告：是否抓到「真實 cgroup」資料（cpu_usec > 0）還是退化成 /proc fallback。
#
# 前置（同 run_tests.sh）：
#   make all && make rootfs
#
# 環境受限時（cgroup ro / 無法建 cgroup）仍可通過：telemetry 會 fallback 到 /proc，
# 取樣管線照樣寫入 resource_samples，只是 cpu_usec 會是 0（會在報告中標示）。

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SBX="$ROOT/core/build/sentinelbox"
MON="$ROOT/monitor/target/release/sentinelbox-monitor"
RFS="$ROOT/rootfs/busybox"
PROF="$ROOT/profiles"

# 顏色（避免深藍色）
C_OK=$'\033[0;32m'; C_ERR=$'\033[0;31m'; C_WARN=$'\033[0;33m'; C_INFO=$'\033[0;36m'; C_RST=$'\033[0m'

# 取樣參數
DURATION=3                       # telemetry_load.sh 的 sleep 秒數
EXPECTED_SAMPLES=$((DURATION * 10))   # 10Hz → 期望 ~30 筆
MIN_SAMPLES=15                   # 門檻：期望值的一半，容忍啟動/收尾耗時

# 暫存 DB（含 WAL 副檔），測試前後都清掉
TEST_DB="$SCRIPT_DIR/.telemetry_test.db"
cleanup() { rm -f "$TEST_DB" "$TEST_DB-wal" "$TEST_DB-shm"; }
trap cleanup EXIT
cleanup

# ── Pre-flight ──────────────────────────────────────────────────────────
for f in "$SBX" "$MON"; do
  if [[ ! -x "$f" ]]; then
    echo "${C_WARN}[SKIP]${C_RST} 找不到可執行檔: $f"
    echo "  先執行: make all"
    exit 2
  fi
done
if [[ ! -d "$RFS" ]]; then
  echo "${C_WARN}[SKIP]${C_RST} rootfs 不存在: $RFS"
  echo "  先執行: make rootfs"
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "${C_WARN}[SKIP]${C_RST} 需要 python3 來查詢 SQLite（stdlib sqlite3）"
  exit 2
fi

# 把負載樣本放進 rootfs/tmp（lowerdir 預先放，沙盒內 /tmp 才看得到）
cp "$SCRIPT_DIR/samples/telemetry_load.sh" "$RFS/tmp/" 2>/dev/null || true

echo "${C_INFO}=== Phase 3 Telemetry & DB 測試 ===${C_RST}"
echo "DB        : $TEST_DB"
echo "負載時長  : ${DURATION}s（期望 ~${EXPECTED_SAMPLES} 筆樣本，門檻 >= ${MIN_SAMPLES}）"
echo

# ── 跑沙盒負載 ───────────────────────────────────────────────────────────
# 優先透過 scripts/run.sh 執行：它會自動處理 cgroup2 delegation
# （在 WSL / systemd user session 啟用 +cpu +memory +pids 並帶 --cgroup-parent），
# 這樣 telemetry 才抓得到「真實 cgroup」資料而非 /proc fallback。
# 若 run.sh 不存在（舊 checkout）則退化為直接呼叫 binary。
RUN_SH="$ROOT/scripts/run.sh"
echo "${C_INFO}[1/2] 執行 sandbox 負載...${C_RST}"
START=$(date +%s.%N)
if [[ -f "$RUN_SH" ]]; then
  echo "  (透過 scripts/run.sh，自動處理 cgroup delegation)"
  SENTINELBOX_DB="$TEST_DB" SENTINELBOX_ROOTFS="$RFS" SENTINELBOX_PROFILE=strict \
    bash "$RUN_SH" -- /bin/sh /tmp/telemetry_load.sh
else
  echo "  (直接呼叫 binary，無 cgroup delegation → 可能走 /proc fallback)"
  SENTINELBOX_DB="$TEST_DB" \
    "$SBX" --profile=strict --rootfs="$RFS" --profile-dir="$PROF" --monitor="$MON" \
    -- /bin/sh /tmp/telemetry_load.sh
fi
RC=$?
END=$(date +%s.%N)
WALL=$(awk "BEGIN{printf \"%.2f\", $END - $START}")
echo "  sandbox exit=$RC，wall=${WALL}s"

if [[ ! -f "$TEST_DB" ]]; then
  echo "${C_ERR}[FAIL]${C_RST} 沒有產生 DB 檔：$TEST_DB（monitor 未啟動或 SENTINELBOX_DB 未生效）"
  exit 1
fi

# ── 查詢並斷言 ───────────────────────────────────────────────────────────
echo
echo "${C_INFO}[2/2] 查詢 audit log 並斷言...${C_RST}"
python3 - "$TEST_DB" "$MIN_SAMPLES" "$EXPECTED_SAMPLES" <<'PY'
import sqlite3, sys

db, min_samples, expected = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
OK, ERR, WARN, INFO, RST = "\033[0;32m", "\033[0;31m", "\033[0;33m", "\033[0;36m", "\033[0m"

con = sqlite3.connect(db)
cur = con.cursor()
fails = []

def check(cond, msg):
    tag = f"{OK}[PASS]{RST}" if cond else f"{ERR}[FAIL]{RST}"
    print(f"  {tag} {msg}")
    if not cond:
        fails.append(msg)

# --- executions ---
# 欄位防呆：不同版本 binary 的 executions schema 可能缺少 pid/command
# （pid/command 是 commit dbbb0f0 才加入）。只查實際存在的欄位，避免
# 「no such column」直接 traceback；缺漏欄位以 None 呈現。
cols = {r[1] for r in cur.execute("PRAGMA table_info(executions)").fetchall()}
core = ["id", "profile", "status", "start_ts", "end_ts"]
missing_core = [c for c in core if c not in cols]
check(not missing_core, f"executions 具備核心欄位 {core}（缺：{missing_core or '無'}）")
if missing_core:
    print(f"{ERR}executions schema 不符（可能 binary 過舊，請 make all 重建）{RST}")
    sys.exit(1)

want = core + [c for c in ("pid", "command") if c in cols]
row = cur.execute(
    f"SELECT {', '.join(want)} FROM executions ORDER BY id DESC LIMIT 1"
).fetchone()
check(row is not None, "executions 至少有 1 筆執行紀錄")
if row is None:
    print(f"{ERR}沒有任何 execution，無法繼續{RST}")
    sys.exit(1)

rec = dict(zip(want, row))
exec_id = rec["id"]
print(f"  {INFO}exec_id={exec_id} profile={rec['profile']} status={rec['status']} "
      f"pid={rec.get('pid')} cmd={rec.get('command')!r}{RST}")
if "pid" not in cols or "command" not in cols:
    print(f"  {WARN}[schema]{RST} 此 binary 的 executions 缺 pid/command 欄位 "
          f"→ 不是最新 build（make all 可更新）。不影響 telemetry 斷言。")
check(rec["end_ts"] is not None, "execution 已正常收尾（end_ts 已寫入）")
check(rec["status"] == "completed", f"execution status=completed（實際 {rec['status']!r}）")
if rec["end_ts"] and rec["start_ts"]:
    print(f"  {INFO}execution 時長 = {(rec['end_ts'] - rec['start_ts'])/1000:.2f}s{RST}")

# --- resource_samples（核心：10Hz 取樣率）---
n, mem_max, cpu_usec_max, cpu_pct_max = cur.execute(
    "SELECT COUNT(*), MAX(mem_bytes), MAX(cpu_usec), MAX(cpu_pct) "
    "FROM resource_samples WHERE exec_id=?", (exec_id,)
).fetchone()
print(f"  {INFO}resource_samples={n}（期望 ~{expected}）  "
      f"mem_max={ (mem_max or 0)//1024 } KiB  "
      f"cpu_usec_max={cpu_usec_max or 0}  cpu_pct_max={cpu_pct_max or 0:.1f}%{RST}")
check(n >= min_samples, f"resource_samples 筆數 >= {min_samples}（取樣率符合 ~10Hz）")
check((mem_max or 0) > 0, "至少一筆樣本 mem_bytes > 0（記憶體取樣有效）")

# ts 單調遞增 + 相鄰間隔接近 100ms（抽查取樣節奏）
ts = [r[0] for r in cur.execute(
    "SELECT ts FROM resource_samples WHERE exec_id=? ORDER BY ts", (exec_id,)
).fetchall()]
monotonic = all(b >= a for a, b in zip(ts, ts[1:]))
check(monotonic, "resource_samples 的 ts 單調遞增")
if len(ts) >= 3:
    gaps = [b - a for a, b in zip(ts, ts[1:])]
    avg = sum(gaps) / len(gaps)
    print(f"  {INFO}平均取樣間隔 = {avg:.0f}ms（目標 100ms）{RST}")

# --- 軟性報告：真實 cgroup vs /proc fallback ---
if (cpu_usec_max or 0) > 0:
    print(f"  {OK}[cgroup]{RST} 偵測到真實 cgroup 取樣（cpu_usec>0），cpu.stat 讀取成功")
else:
    print(f"  {WARN}[cgroup]{RST} cpu_usec 全為 0 → 本環境退化為 /proc fallback "
          f"（cgroup 唯讀或未建立）。取樣管線本身正常。")

# --- syscall_events（資訊性）---
sc = cur.execute(
    "SELECT COUNT(*) FROM syscall_events WHERE exec_id=?", (exec_id,)
).fetchone()[0]
print(f"  {INFO}syscall_events={sc} 筆（資訊性，不斷言）{RST}")

con.close()
if fails:
    print(f"\n{ERR}==== FAIL：{len(fails)} 項斷言未通過 ===={RST}")
    sys.exit(1)
print(f"\n{OK}==== PASS：telemetry & DB 管線驗證通過 ===={RST}")
PY
exit $?
