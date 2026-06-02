#!/usr/bin/env bash
# tests/test_cgroup_direct.sh - 直接驗證 cgroup（不經沙盒，不需 user namespace）
#
# 用途：在「cgroup 可用、但 user namespace 被擋」的環境(RunPod / 多數容器)
#       單獨證明 Phase 3 的 cgroup 功能。它編譯 tests/cgroup_proof.c，
#       連結你自家的 core/src/cgroup.c + util.c，呼叫真正的 sb_cg_* 函式。
#
# 需要：cgroup v2、parent cgroup 可寫、controllers 有 memory。
#       (RunPod 預檢若 cgroup2fs + WRITABLE + controllers 有 memory 就 OK)

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
C_OK=$'\033[0;32m'; C_ERR=$'\033[0;31m'; C_WARN=$'\033[0;33m'; C_INFO=$'\033[0;36m'; C_RST=$'\033[0m'

CG_ROOT="/sys/fs/cgroup"
BIN=/tmp/sb_cgroup_proof

# ── 1) 找一個可寫、可 enable memory 的 parent cgroup ────────────────────
if [[ "$(stat -fc %T "$CG_ROOT" 2>/dev/null)" != "cgroup2fs" ]]; then
  echo "${C_WARN}[SKIP]${C_RST} $CG_ROOT 不是 cgroup2（需 cgroup v2 unified）"; exit 2
fi

# 要讓子 cgroup 有 memory.max，必須在 parent 的 subtree_control 啟用 +memory。
# 但 cgroup v2「no internal process」規則：cgroup 若直接含有行程(容器 root 通常
# 有 shell/sshd)就不能寫 subtree_control。因此先把行程移到 holding cgroup 讓
# root 淨空，再啟用 controller。
PARENT="$CG_ROOT"
SUB="$CG_ROOT/cgroup.subtree_control"

# 逐一啟用：subtree_control 的寫入是 atomic，若 "+memory +cpu +pids" 其中一個
# 無法啟用(例如 cpu 需 cpuset 條件)，整筆會失敗、連 memory 都進不去。我們只需要
# memory，故每個分開寫，互不影響。
enable_ctrl() {
  for c in memory cpu pids; do echo "+$c" > "$SUB" 2>/dev/null || true; done
  grep -qw memory "$SUB" 2>/dev/null
}

if ! enable_ctrl; then
  echo "${C_INFO}root cgroup 含行程，依 no-internal-process 規則先搬移行程...${C_RST}"
  INIT="$CG_ROOT/sbtest_init.$$"
  if mkdir -p "$INIT" 2>/dev/null && [[ -r "$CG_ROOT/cgroup.procs" ]]; then
    # 先把自己搬進 INIT，之後本腳本 spawn 的子行程就不會再落在 root
    echo $$ > "$INIT/cgroup.procs" 2>/dev/null || true
    # 多輪搬移：迴圈中可能有行程剛 spawn 落在 root，重試到淨空或無進展
    for pass in 1 2 3 4 5; do
      while read -r p; do
        [[ -n "$p" ]] && echo "$p" > "$INIT/cgroup.procs" 2>/dev/null || true
      done < "$CG_ROOT/cgroup.procs"
      [[ "$(wc -l < "$CG_ROOT/cgroup.procs")" -eq 0 ]] && break
    done
    left=$(wc -l < "$CG_ROOT/cgroup.procs")
    echo "  搬移後 root 剩 $left 個行程"
    if [[ "$left" -ne 0 ]]; then
      echo "  仍卡在 root 的行程："
      while read -r p; do
        [[ -n "$p" ]] && echo "    pid $p = $(cat /proc/$p/comm 2>/dev/null || echo '?')"
      done < "$CG_ROOT/cgroup.procs"
    fi
    enable_ctrl || true
  fi
fi

echo "${C_INFO}controllers 可用 = [$(cat "$CG_ROOT/cgroup.controllers" 2>/dev/null)]${C_RST}"
echo "${C_INFO}subtree_control = [$(cat "$SUB" 2>/dev/null)]${C_RST}"
if ! grep -qw memory "$SUB" 2>/dev/null; then
  # 顯示真正的 errno 幫助診斷
  err=$( { echo "+memory" > "$SUB"; } 2>&1 ) || true
  echo "${C_WARN}[SKIP]${C_RST} 無法啟用 memory controller。寫入 subtree_control 的錯誤：${err:-<未知>}"
  echo "       cgroup 限制在此環境無法強制——請在乾淨 Linux VM(root)重跑。"
  exit 2
fi

# ── 2) 編譯 harness（連結你自家 cgroup.c + util.c）──────────────────────
echo "${C_INFO}編譯 tests/cgroup_proof.c (連結 core/src/cgroup.c + util.c)...${C_RST}"
if ! gcc -O2 -I"$ROOT/core/include" \
     "$SCRIPT_DIR/cgroup_proof.c" "$ROOT/core/src/cgroup.c" "$ROOT/core/src/util.c" \
     -o "$BIN"; then
  echo "${C_ERR}[FAIL]${C_RST} 編譯失敗"; exit 1
fi

# ── 3) 執行證據程式 ──────────────────────────────────────────────────────
echo "${C_INFO}執行...（parent=$PARENT）${C_RST}"
"$BIN" "$PARENT"
rc=$?

# 清理中介 cgroup（若有建）
[[ "$PARENT" != "$CG_ROOT" ]] && rmdir "$PARENT" 2>/dev/null || true
exit $rc
