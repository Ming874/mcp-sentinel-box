#!/usr/bin/env bash
# tests/demo_cgroup.sh - Phase 3 cgroup 強制力「展示版」(適合截圖)
#
# 與 test_cgroup_direct.sh 同樣繞過沙盒、直接呼叫自家 cgroup.c，但輸出為
# 彩色排版 + 進度條 + 結論表，並多展示一項 cpu.max 配額強制。
#
# 需要：cgroup v2、可在 parent enable +memory +cpu。容器 root 含行程時會
#       自動依 no-internal-process 規則搬移行程後再啟用 controller。

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
C_WARN=$'\033[0;33m'; C_INFO=$'\033[0;36m'; C_ERR=$'\033[0;31m'; C_RST=$'\033[0m'
CG_ROOT="/sys/fs/cgroup"
SUB="$CG_ROOT/cgroup.subtree_control"
BIN=/tmp/sb_cgroup_demo

[[ "$(stat -fc %T "$CG_ROOT" 2>/dev/null)" == "cgroup2fs" ]] || {
  echo "${C_WARN}[SKIP]${C_RST} 需要 cgroup v2 (cgroup2fs)"; exit 2; }

# 啟用 controller（逐一寫，避免 atomic 失敗）
enable_ctrl(){ for c in memory cpu pids; do echo "+$c" > "$SUB" 2>/dev/null || true; done; grep -qw memory "$SUB" 2>/dev/null; }

if ! enable_ctrl; then
  # no-internal-process：先把 root 內行程搬到 holding cgroup 再啟用
  INIT="$CG_ROOT/sbdemo_init.$$"
  if mkdir -p "$INIT" 2>/dev/null; then
    echo $$ > "$INIT/cgroup.procs" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      while read -r p; do [[ -n "$p" ]] && echo "$p" > "$INIT/cgroup.procs" 2>/dev/null || true; done < "$CG_ROOT/cgroup.procs"
      [[ "$(wc -l < "$CG_ROOT/cgroup.procs")" -eq 0 ]] && break
    done
    enable_ctrl || true
  fi
fi
grep -qw memory "$SUB" 2>/dev/null || {
  echo "${C_WARN}[SKIP]${C_RST} 此環境無法啟用 memory controller（cgroup 未充分 delegate）→ 請在乾淨 Linux VM(root) 重跑"; exit 2; }

gcc -O2 -I"$ROOT/core/include" "$SCRIPT_DIR/cgroup_demo.c" \
    "$ROOT/core/src/cgroup.c" "$ROOT/core/src/util.c" -o "$BIN" || {
  echo "${C_ERR}編譯失敗${C_RST}"; exit 1; }

"$BIN" "$CG_ROOT"
exit $?
