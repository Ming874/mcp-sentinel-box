#!/usr/bin/env bash
# tests/run_tests.sh - SentinelBox 端到端整合測試
#
# 假設：
#   1. 已執行 make all   （core/build/sentinelbox 與 monitor/target/release/sentinelbox-monitor 存在）
#   2. 已執行 make rootfs (rootfs/busybox 內含 busybox + symlink)
#   3. /sys/fs/cgroup 為 cgroup2，且 user 已做 delegation；或以 sudo 跑此腳本
#
# 每個測試對應一個 sample 與預期結果：
#   hello.sh             → exit 0
#   malicious_network.sh → sandbox 內 connect 被 NOTIFY，sample 自身仍然回 exit 0（但會印拒絕訊息）
#   malicious_mount.sh   → sandbox 被 SIGKILL；sentinelbox 回非 0 exit
#   oom_bomb.sh          → sandbox 被 OOM-Kill 或 dd 失敗

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SBX="$ROOT/core/build/sentinelbox"
MON="$ROOT/monitor/target/release/sentinelbox-monitor"
RFS="$ROOT/rootfs/busybox"
PROF="$ROOT/profiles"

PASS=0
FAIL=0

# 助手：跑單一測試並比對 exit code 是否在預期範圍
run_case() {
  local name="$1"; shift
  local expect_min="$1"; shift
  local expect_max="$1"; shift
  echo
  echo "=== TEST: $name ==="
  echo "$SBX --profile=strict --rootfs=$RFS --monitor=$MON -- $*"
  "$SBX" --profile=strict --rootfs="$RFS" --monitor="$MON" -- "$@"
  local rc=$?
  if [[ "$rc" -ge "$expect_min" && "$rc" -le "$expect_max" ]]; then
    echo "[PASS] $name (rc=$rc)"
    PASS=$((PASS+1))
  else
    echo "[FAIL] $name (rc=$rc, expected $expect_min..$expect_max)"
    FAIL=$((FAIL+1))
  fi
}

# Pre-flight 檢查
for f in "$SBX" "$MON"; do
  if [[ ! -x "$f" ]]; then
    echo "[SKIP] 找不到可執行檔: $f"
    echo "  先執行: make all"
    exit 2
  fi
done
if [[ ! -d "$RFS" ]]; then
  echo "[SKIP] rootfs 不存在: $RFS"
  echo "  先執行: make rootfs"
  exit 2
fi

# 把 samples 複製到 rootfs/tmp 以便沙盒內 /tmp 可看到（lowerdir 預先放）
cp "$SCRIPT_DIR"/samples/*.sh "$RFS/tmp/" 2>/dev/null || true

# 案例 1：良性 hello
run_case "hello"        0   0  /bin/sh /tmp/hello.sh

# 案例 2：惡意網路（sample 自己有 || 兜底，rc=0 為預期）
run_case "mal_network"  0   0  /bin/sh /tmp/malicious_network.sh

# 案例 3：惡意 mount（KILL action 應殺掉 sandbox，rc 137 或 1）
run_case "mal_mount"    1 255  /bin/sh /tmp/malicious_mount.sh

# 案例 4：OOM bomb（rc 137 或 sample tail ||  → 0；視 dd 行為而定）
run_case "oom_bomb"     0 255  /bin/sh /tmp/oom_bomb.sh

echo
echo "==== 測試摘要: PASS=$PASS FAIL=$FAIL ===="
[[ "$FAIL" -eq 0 ]] || exit 1
