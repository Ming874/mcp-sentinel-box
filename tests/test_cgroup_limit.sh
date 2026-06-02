#!/usr/bin/env bash
# tests/test_cgroup_limit.sh - Phase 3 cgroup「限制強制力」證據測試
#
# 這支跟 test_telemetry.sh 不同：test_telemetry 證明「取樣管線會跑」，
# 這支證明「cgroup 真的有作用」—— 設了 memory.max=128MiB，沙盒嘗試配置
# 200MiB，被 cgroup OOM 殺掉，且 telemetry 抓到 mem 卡在 ~128MiB 上限。
#
# 自我判別(不會在無 cgroup 環境誤判 FAIL)：
#   - 真實 cgroup：resource_samples 的 cpu_usec>0（成功讀到 cgroup cpu.stat）
#                  → 硬性斷言「被殺 + mem 被 cap 在 128MiB」=== 證據成立 ===
#   - fallback   ：cpu_usec 全為 0（讀不到 cgroup，退化 /proc）
#                  → SKIP(rc=2) 並說明「此環境 cgroup 未授權，無法證明」
#
# 需要 cgroup v2 且 controller 有 delegate 的環境。WSL / 巢狀容器通常不行；
# 乾淨 Linux VM(root)或 delegation 正常的容器可以。

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SBX="$ROOT/core/build/sentinelbox"
MON="$ROOT/monitor/target/release/sentinelbox-monitor"
RFS="$ROOT/rootfs/busybox"
PROF="$ROOT/profiles"
RUN_SH="$ROOT/scripts/run.sh"

C_OK=$'\033[0;32m'; C_ERR=$'\033[0;31m'; C_WARN=$'\033[0;33m'; C_INFO=$'\033[0;36m'; C_RST=$'\033[0m'

LIMIT=134217728   # strict profile mem_limit_bytes = 128 MiB

TEST_DB="$SCRIPT_DIR/.cgroup_limit_test.db"
cleanup() { rm -f "$TEST_DB" "$TEST_DB-wal" "$TEST_DB-shm"; }
trap cleanup EXIT
cleanup

# ── Pre-flight ──────────────────────────────────────────────────────────
for f in "$SBX" "$MON"; do
  if [[ ! -x "$f" ]]; then
    echo "${C_WARN}[SKIP]${C_RST} 找不到可執行檔: $f（先 make all）"; exit 2
  fi
done
[[ -d "$RFS" ]] || { echo "${C_WARN}[SKIP]${C_RST} rootfs 不存在: $RFS（先 make rootfs）"; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "${C_WARN}[SKIP]${C_RST} 需要 python3"; exit 2; }

cp "$SCRIPT_DIR/samples/mem_bomb.sh" "$RFS/tmp/" 2>/dev/null || true

echo "${C_INFO}=== Phase 3 cgroup 限制強制力測試（memory.max=128MiB）===${C_RST}"
echo "DB: $TEST_DB"
echo

# ── 跑 mem bomb（200MiB > 128MiB 上限）──────────────────────────────────
echo "${C_INFO}[1/2] 在 strict(128MiB) 下執行 200MiB 記憶體炸彈...${C_RST}"
if [[ -f "$RUN_SH" ]]; then
  echo "  (透過 scripts/run.sh，自動處理 cgroup delegation)"
  SENTINELBOX_DB="$TEST_DB" SENTINELBOX_ROOTFS="$RFS" SENTINELBOX_PROFILE=strict \
    bash "$RUN_SH" -- /bin/sh /tmp/mem_bomb.sh
else
  SENTINELBOX_DB="$TEST_DB" \
    "$SBX" --profile=strict --rootfs="$RFS" --profile-dir="$PROF" --monitor="$MON" \
    -- /bin/sh /tmp/mem_bomb.sh
fi
RC=$?
echo "  sandbox exit code = $RC  (137 = 128+SIGKILL，OOM 被殺的典型值)"

[[ -f "$TEST_DB" ]] || { echo "${C_ERR}[FAIL]${C_RST} 沒有產生 DB"; exit 1; }

# ── 判別 + 斷言 ──────────────────────────────────────────────────────────
echo
echo "${C_INFO}[2/2] 分析 resource_samples 判定 cgroup 是否真的強制限制...${C_RST}"
python3 - "$TEST_DB" "$LIMIT" "$RC" <<'PY'
import sqlite3, sys
db, limit, rc = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
OK, ERR, WARN, INFO, RST = "\033[0;32m","\033[0;31m","\033[0;33m","\033[0;36m","\033[0m"
limit_mb = limit / 1024 / 1024

con = sqlite3.connect(db); cur = con.cursor()
eid = cur.execute("SELECT id FROM executions ORDER BY id DESC LIMIT 1").fetchone()
if not eid:
    print(f"{ERR}沒有 execution{RST}"); sys.exit(1)
eid = eid[0]

n, mem_max, cpu_usec_max = cur.execute(
    "SELECT COUNT(*), MAX(mem_bytes), MAX(cpu_usec) FROM resource_samples WHERE exec_id=?",
    (eid,)).fetchone()
mem_max = mem_max or 0
cpu_usec_max = cpu_usec_max or 0
print(f"  {INFO}samples={n}  mem_peak={mem_max/1024/1024:.1f} MiB  "
      f"cpu_usec_max={cpu_usec_max}  上限={limit_mb:.0f} MiB{RST}")

# --- 真實 cgroup 判別：cpu_usec>0 表示成功讀到 cgroup cpu.stat ---
real_cgroup = cpu_usec_max > 0
if not real_cgroup:
    print(f"\n{WARN}[SKIP]{RST} 此環境 cgroup 未授權（cpu_usec 全為 0，走 /proc fallback）。")
    print(f"       沙盒沒被加進 cgroup，memory.max 無從強制，因此「無法在此證明」。")
    print(f"       請在 cgroup delegation 正常的機器(乾淨 Linux VM / root)重跑。")
    con.close(); sys.exit(2)   # SKIP，不算 FAIL

print(f"  {OK}[real cgroup]{RST} cpu_usec>0 → 沙盒確實在 cgroup 內，cpu.stat 讀取成功")

# --- 硬性證據斷言 ---
fails = []
def check(cond, msg):
    print(f"  {OK+'[PASS]' if cond else ERR+'[FAIL]'}{RST} {msg}")
    if not cond: fails.append(msg)

# 1) 被殺：200MiB 撞穿 128MiB 應被 OOM SIGKILL → 沙盒非 0 退出
check(rc != 0, f"沙盒被殺（rc={rc}≠0；cgroup OOM 攔截 200MiB 配置）")

# 2) mem 被 cap：memory.current 不可能遠超 memory.max；峰值應 ≈128MiB
check(mem_max <= limit * 1.10,
      f"mem 峰值 ≤ 上限×1.1（{mem_max/1024/1024:.1f} ≤ {limit_mb*1.1:.0f} MiB；被 memory.max cap 住）")

# 3) 確實有爬到上限附近(不是還沒配置就掛)
check(mem_max >= limit * 0.50,
      f"mem 峰值 ≥ 上限×0.5（{mem_max/1024/1024:.1f} ≥ {limit_mb*0.5:.0f} MiB；確實逼近上限才被擋）")

con.close()
if fails:
    print(f"\n{ERR}==== 證據不成立：{len(fails)} 項未通過 ===={RST}"); sys.exit(1)
print(f"\n{OK}==== 證據成立：cgroup memory.max(128MiB) 確實強制生效 ===={RST}")
print(f"{OK}     200MiB 配置被 cgroup OOM 攔截，telemetry 抓到 mem 卡在上限。{RST}")
PY
exit $?
