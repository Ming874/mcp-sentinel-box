#!/usr/bin/env bash
# provision.sh - 從「空白 Ubuntu VM」一鍵建置到「可執行 SentinelBox」
#
# 目的：可重現性。所有人（隊友 / 助教 / CI）跑同一支腳本，得到同一套環境，
#       消除「在我機器上能跑」。設計為可獨立貼進全新 VM 執行（不需先有 git / repo）。
#
# 與其他腳本的關係：
#   provision.sh ─(裝 git + clone)→ setup.sh ─(裝編譯依賴 + make)→ run.sh（執行沙盒）
#   provision = 整機 bootstrap；setup = repo 內建置；run = 跑單次沙盒。
#
# 使用（全新 VM 內，互動式以便輸入 sudo 密碼）：
#   curl -fsSL <raw-url>/scripts/provision.sh | bash      # 若 repo 公開
#   或：先手動下載本檔，bash provision.sh
#
# 環境變數（皆可選）：
#   SB_REPO_URL   clone 來源（預設公開 https）；私有 repo 傳含 token 的 URL
#   SB_DIR        clone 目的地（預設 ~/mcp-sentinel-box）
#   SB_BRANCH     分支（預設 main）
set -euo pipefail

# 顏色（避免深藍色）
C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'; C_ERR=$'\033[0;31m'; C_RST=$'\033[0m'
log()  { echo "${C_OK}[provision]${C_RST} $*"; }
warn() { echo "${C_WARN}[provision] 警告：${C_RST} $*"; }
die()  { echo "${C_ERR}[provision] 錯誤：${C_RST} $*" >&2; exit 1; }

SB_REPO_URL="${SB_REPO_URL:-https://github.com/Ming874/mcp-sentinel-box.git}"
SB_DIR="${SB_DIR:-$HOME/mcp-sentinel-box}"
SB_BRANCH="${SB_BRANCH:-main}"

# ── 0. 前置檢查：必須是 Linux + apt ──────────────────────────────────────
[[ "$(uname -s)" == "Linux" ]] || die "本腳本僅支援 Linux（SentinelBox 用 namespaces/seccomp/cgroup，非 macOS）。請在 VM 內執行。"
command -v apt-get >/dev/null 2>&1 || die "需要 apt 系統（Ubuntu/Debian）。"

KMAJ=$(uname -r | cut -d. -f1); KMIN=$(uname -r | cut -d. -f2)
if (( KMAJ < 5 || (KMAJ == 5 && KMIN < 15) )); then
  warn "kernel $(uname -r) < 5.15，cgroup v2 / seccomp user-notif 可能不完整。"
fi

# ── 1. 裝 git（bootstrap 最小需求）───────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  log "安裝 git..."
  sudo apt-get update
  sudo apt-get install -y git
fi

# ── 2. clone 或更新 repo ─────────────────────────────────────────────────
if [[ -d "$SB_DIR/.git" ]]; then
  log "repo 已存在於 $SB_DIR，改為更新..."
  git -C "$SB_DIR" fetch --quiet origin "$SB_BRANCH"
  git -C "$SB_DIR" checkout --quiet "$SB_BRANCH"
  git -C "$SB_DIR" pull --quiet
else
  log "clone $SB_REPO_URL → $SB_DIR ..."
  git clone --branch "$SB_BRANCH" "$SB_REPO_URL" "$SB_DIR" \
    || die "clone 失敗。若為私有 repo，請設 SB_REPO_URL 為含 token 的 URL。"
fi

# ── 3. 委派給 setup.sh 裝編譯依賴 + 編譯 + rootfs ─────────────────────────
log "執行 setup.sh（依賴 + 編譯 + rootfs）..."
bash "$SB_DIR/scripts/setup.sh"

# ── 4. smoke test ────────────────────────────────────────────────────────
log "smoke test：跑一次沙盒 hello..."
if bash "$SB_DIR/scripts/run.sh" -- /bin/sh -c "echo hello from sandbox"; then
  log "完成。環境就緒。日後執行： bash $SB_DIR/scripts/run.sh -- /bin/sh -c 'echo hi'"
else
  warn "沙盒執行未成功（可能 cgroup delegation 未設）。見 scripts/setup_cgroup.sh。"
fi
