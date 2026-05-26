#!/usr/bin/env bash
# setup.sh - 原生 Linux / VM 一鍵環境建置（Docker 之外的第二條路徑）
#
# 為什麼需要這支：
#   Docker 交付路徑在巢狀 container 缺 SYS_ADMIN、不能 remount /proc，
#   沙盒（pivot_root + mount）跑不全；且 eBPF 需要 BTF + tracefs + CAP_BPF。
#   完整 Linux VM（kernel 5.15+，附 /sys/kernel/btf/vmlinux）才能完整跑起來。
#   本腳本把原本散在 Dockerfile 的 apt 安裝收斂成原生可重現步驟。
#
# 使用：
#   bash scripts/setup.sh            # 裝依賴 + 編譯 + 建 rootfs
#   bash scripts/setup.sh --deps     # 只裝系統依賴
#   bash scripts/setup.sh --no-deps  # 跳過 apt，只編譯 + rootfs
#
# 之後用 scripts/run.sh 執行沙盒。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 顏色（避免深藍色）
C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'; C_RST=$'\033[0m'
log()  { echo "${C_OK}[setup]${C_RST} $*"; }
warn() { echo "${C_WARN}[setup] 警告：${C_RST} $*"; }

DO_DEPS=1; DO_BUILD=1
case "${1:-}" in
  --deps)    DO_BUILD=0 ;;
  --no-deps) DO_DEPS=0 ;;
  "" )       ;;
  * ) echo "未知參數: $1（用法見檔頭註解）" >&2; exit 2 ;;
esac

# ── 1. 系統依賴 ──────────────────────────────────────────────────────────
# libelf-dev / clang 為 eBPF (libbpf CO-RE) 與後續 probe 編譯所需。
if [[ "$DO_DEPS" == 1 ]]; then
  if ! command -v apt-get >/dev/null 2>&1; then
    warn "非 apt 系統，請手動安裝：build-essential libseccomp-dev libcap-dev libelf-dev clang busybox-static sqlite3"
  else
    log "安裝系統依賴 (需 sudo)..."
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends \
      build-essential libseccomp-dev libcap-dev libelf-dev clang llvm \
      pkg-config busybox-static sqlite3 ca-certificates curl
  fi

  # Rust toolchain：沙盒 monitor 需要 stable（edition 2021）
  if ! command -v cargo >/dev/null 2>&1; then
    log "安裝 Rust toolchain (rustup)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
fi

# ── 2. 環境檢查 ──────────────────────────────────────────────────────────
KREL="$(uname -r)"
log "kernel: $KREL"
if [[ -r /sys/kernel/btf/vmlinux ]]; then
  log "BTF 存在 → eBPF CO-RE 可用"
else
  warn "無 /sys/kernel/btf/vmlinux → eBPF probe 將自動降級為 cgroup 取樣"
fi
CG2_MOUNT=$(mount -t cgroup2 | head -n 1 | awk '{print $3}')
if [[ -n "$CG2_MOUNT" ]]; then
  log "cgroup2 偵測到掛載於 $CG2_MOUNT"
else
  warn "找不到 cgroup2 unified hierarchy → cgroup 限制可能無效（見 scripts/setup_cgroup.sh）"
fi

# ── 3. 編譯 + rootfs ─────────────────────────────────────────────────────
if [[ "$DO_BUILD" == 1 ]]; then
  log "編譯 core (C) + monitor (Rust)..."
  make all
  log "建立 busybox rootfs..."
  make rootfs
  log "完成。執行沙盒： bash scripts/run.sh -- /bin/sh -c 'echo hello from sandbox'"
fi
