#!/usr/bin/env bash
# setup_rootfs.sh - 建立沙盒用的最小 rootfs（基於 busybox-static）
#
# 為什麼用 busybox：
#   - 單檔 ~1MB，包含 sh / cat / ls / echo 等基本工具，足以 demo 沙盒能執行任意命令。
#   - 老師指定可用 busybox（見 AGENT.md "base rootfs"）。
#   - 完成後 rootfs 目錄路徑直接拿來給 sentinelbox --rootfs= 用。
#
# 使用：
#   sudo apt install busybox-static     # 取得 busybox 二進位
#   bash scripts/setup_rootfs.sh ./rootfs/busybox
#
# 之後即可：
#   ./core/build/sentinelbox --profile=strict --rootfs=./rootfs/busybox -- /bin/sh -c "echo hi"
set -euo pipefail

ROOT="${1:-./rootfs/busybox}"

if [[ ! -x "$(command -v busybox)" ]]; then
  echo "[setup_rootfs] 找不到 busybox，請先：sudo apt install busybox-static" >&2
  exit 1
fi

echo "[setup_rootfs] 建立 rootfs 目錄結構於 ${ROOT}"
mkdir -p "$ROOT"/{bin,sbin,usr/bin,usr/sbin,etc,proc,sys,dev,tmp,var/log}

# 把 busybox 複製進來；--install 會建立眾多 symlink (ls, cat, sh, ...)
cp "$(command -v busybox)" "$ROOT/bin/busybox"
"$ROOT/bin/busybox" --install -s "$ROOT/bin"

# 最小 /etc 設定，讓沙盒內 sh / id / hostname 等命令運作不會炸
cat > "$ROOT/etc/passwd" <<'EOF'
root:x:0:0:root:/root:/bin/sh
nobody:x:65534:65534:nobody:/:/sbin/nologin
EOF

cat > "$ROOT/etc/group" <<'EOF'
root:x:0:
nogroup:x:65534:
EOF

# /etc/hostname 可有可無，沙盒會 sethostname 蓋過去
echo "sentinelbox" > "$ROOT/etc/hostname"

echo "[setup_rootfs] 完成。可執行："
echo "  ./core/build/sentinelbox --profile=strict --rootfs=$ROOT -- /bin/sh -c 'echo hello from sandbox'"
