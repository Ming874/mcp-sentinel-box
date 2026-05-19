#!/usr/bin/env bash
# docker-entrypoint.sh - SentinelBox 容器進入點
#
# 職責：
#   1. 確認 cgroup v2 可寫（--privileged + --cgroupns=private 時才有）
#   2. 確保 audit DB 目錄存在
#   3. 把環境變數轉成 sentinelbox 旗標，exec 過去
#
# 使用範例：
#   docker run --privileged --cgroupns=private sentinelbox:latest \
#       -- /bin/sh -c "echo hello"
#
#   docker run --privileged --cgroupns=private -e SENTINELBOX_PROFILE=datascience \
#       sentinelbox:latest -- python3 -c "import math; print(math.pi)"

set -euo pipefail

# ── 1. 確認 cgroup v2 已掛載且可寫 ──────────────────────────────────────
CGROUP_ROOT=/sys/fs/cgroup
if ! mountpoint -q "$CGROUP_ROOT"; then
    echo "[entrypoint] 警告：$CGROUP_ROOT 未掛載，cgroup 限制無效"
elif [[ ! -w "$CGROUP_ROOT" ]]; then
    echo "[entrypoint] 警告：$CGROUP_ROOT 唯讀，cgroup 限制無效"
    echo "             請使用 --privileged --cgroupns=private 啟動"
fi

# ── 2. 確保 audit DB 目錄存在 ────────────────────────────────────────────
DB_DIR=$(dirname "${SENTINELBOX_DB:-/var/lib/sentinelbox/audit.db}")
mkdir -p "$DB_DIR"

# ── 3. 執行沙盒 ──────────────────────────────────────────────────────────
exec sentinelbox \
    --profile="${SENTINELBOX_PROFILE:-strict}" \
    --rootfs=/srv/rootfs \
    --profile-dir=/etc/sentinelbox/profiles \
    --monitor=/usr/local/bin/sentinelbox-monitor \
    "$@"
