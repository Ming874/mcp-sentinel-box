#!/usr/bin/env bash
# setup_cgroup.sh - 把目前使用者納入 cgroup v2 delegation，讓 sentinelbox 可在 rootless 模式建 cgroup
#
# 背景：
#   cgroup v2 預設只有 root 能在 /sys/fs/cgroup 下建立子 cgroup。
#   要讓 unprivileged user 也能管理自己的 cgroup，必須先做 delegation：
#   systemd 已替每個登入 user 在 user.slice/user-<uid>.slice/user@<uid>.service 內建好子樹。
#   我們在那個子樹下建 sentinelbox.<pid> 即可，不需動 root。
#
# 使用：
#   bash scripts/setup_cgroup.sh
#   (然後 sentinelbox 用 --cgroup-parent=$XDG_RUNTIME_DIR/sentinelbox)
#
# 注意：本腳本只列出建議路徑與檢查當前 kernel cgroup v2 狀態，不會強行寫設定。
set -euo pipefail

echo "[setup_cgroup] 檢查 cgroup v2 是否已啟用..."
if ! mount | grep -qE '\s/sys/fs/cgroup\s.*cgroup2'; then
  echo "  /sys/fs/cgroup 並非 cgroup2 unified hierarchy。"
  echo "  請編輯 /etc/default/grub，加入 systemd.unified_cgroup_hierarchy=1，"
  echo "  然後 update-grub && reboot。"
  exit 1
fi
echo "  OK"

UID_NUM=$(id -u)
USER_CG="/sys/fs/cgroup/user.slice/user-${UID_NUM}.slice/user@${UID_NUM}.service"
if [[ ! -d "$USER_CG" ]]; then
  echo "  找不到使用者 cgroup: $USER_CG"
  echo "  請從 systemd 登入 (systemctl --user 應該可用)，避免 console 直登"
  exit 1
fi

# 確認該 cgroup 已 enable 必要 controller
SUB="$USER_CG/cgroup.subtree_control"
if [[ ! -w "$SUB" ]]; then
  echo "  ${SUB} 無寫權限。可能需要：sudo systemctl edit user@${UID_NUM}.service"
fi

# 我們希望啟用 +memory +cpu +pids
WANT="+memory +cpu +pids"
echo "[setup_cgroup] 建議啟用 controller: $WANT"
echo "  可手動執行: echo \"$WANT\" | sudo tee $SUB"

# 在 user 自己的 cgroup 內建專屬 parent
PARENT="$USER_CG/sentinelbox"
mkdir -p "$PARENT" || true
echo "[setup_cgroup] cgroup parent 已備妥: $PARENT"
echo
echo "下次執行 sentinelbox 帶："
echo "  --cgroup-parent=$PARENT"
