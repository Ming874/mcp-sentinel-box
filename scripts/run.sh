#!/usr/bin/env bash
# run.sh - 原生 / VM 執行沙盒（取代 docker-entrypoint.sh 的薄包裝）
#
# 把環境變數 / 預設值拼成 sentinelbox 旗標後 exec 過去；
# 路徑一律用 repo 內相對位置，無 Docker 依賴。
#
# 使用：
#   bash scripts/run.sh -- /bin/sh -c "echo hello from sandbox"
#   SENTINELBOX_PROFILE=datascience bash scripts/run.sh -- python3 -c "print(1)"
#
# 可用環境變數（皆有預設）：
#   SENTINELBOX_PROFILE      profile 名稱（strict / datascience / web）  預設 strict
#   SENTINELBOX_DB           audit log SQLite 路徑                      預設 ./sentinelbox.db
#   SENTINELBOX_ROOTFS       沙盒 lowerdir                              預設 ./rootfs/busybox
#   SENTINELBOX_LOG          monitor log level (info/debug)             預設 info
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

C_WARN=$'\033[0;33m'; C_RST=$'\033[0m'
warn() { echo "${C_WARN}[run] 警告：${C_RST} $*"; }

PROFILE="${SENTINELBOX_PROFILE:-strict}"
ROOTFS="${SENTINELBOX_ROOTFS:-./rootfs/busybox}"
BIN="./core/build/sentinelbox"
MONITOR="./monitor/target/release/sentinelbox-monitor"

# ── 前置檢查 ─────────────────────────────────────────────────────────────
[[ -x "$BIN" ]]     || { echo "找不到 $BIN，請先 make all" >&2; exit 1; }
[[ -x "$MONITOR" ]] || { echo "找不到 $MONITOR，請先 make all" >&2; exit 1; }
[[ -d "$ROOTFS" ]]  || { echo "找不到 rootfs $ROOTFS，請先 make rootfs" >&2; exit 1; }

if ! mount 2>/dev/null | grep -qE '\s/sys/fs/cgroup\s.*cgroup2'; then
  warn "/sys/fs/cgroup 非 cgroup2 → cgroup 資源限制不會生效"
fi

# audit DB 與 mapping 路徑（沿用 monitor 預設搜尋規則）
export SENTINELBOX_DB="${SENTINELBOX_DB:-$REPO_ROOT/sentinelbox.db}"
export SENTINELBOX_MAPPINGS="${SENTINELBOX_MAPPINGS:-$REPO_ROOT/mappings/syscall_feedback.json}"
export SENTINELBOX_LOG="${SENTINELBOX_LOG:-info}"

exec "$BIN" \
  --profile="$PROFILE" \
  --rootfs="$ROOTFS" \
  --profile-dir="$REPO_ROOT/profiles" \
  --monitor="$MONITOR" \
  "$@"
