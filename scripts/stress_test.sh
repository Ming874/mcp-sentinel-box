#!/usr/bin/env bash
set -euo pipefail

# 1. 嘗試修復 cgroup 權限 (WSL2 專用)
UID_NUM=$(id -u)
CG_BASE="/sys/fs/cgroup/unified/user.slice/user-${UID_NUM}.slice/user@${UID_NUM}.service"

echo "[stress] 正在準備環境..."
# 嘗試將目前 shell 移入 user slice 以獲得授權
if sudo tee "$CG_BASE/cgroup.procs" <<< "$$" > /dev/null 2>&1; then
    echo "  [OK] 成功將目前殼層移入 cgroup delegation 區域。"
else
    echo "  [WARN] cgroup.procs 寫入失敗，您可能需要先執行 scripts/setup_cgroup.sh"
fi

# 啟用控制器
if sudo tee "$CG_BASE/cgroup.subtree_control" <<< "+cpu +memory +pids" > /dev/null 2>&1; then
    echo "  [OK] 成功啟用 cgroup 資源控制器。"
else
    echo "  [WARN] 控制器啟用失敗。"
fi

# 2. 設定參數
CONCURRENCY=4  # 同時跑 4 個沙盒
LOG_FILE="stress_results.log"
rm -f "$LOG_FILE"

echo "[stress] 啟動 $CONCURRENCY 個併行沙盒 (執行 CPU 密集任務)..."

# 3. 併行執行
for i in $(seq 1 $CONCURRENCY); do
  # 在沙盒內執行 sha256sum 大量數據來消耗 CPU
  bash scripts/run.sh -- /bin/sh -c "head -c 20M /dev/zero | sha256sum" > /dev/null 2>> "$LOG_FILE" &
  echo "  沙盒 #$i 已啟動 (PID: $!)"
done

echo "[stress] 等待任務完成..."
wait

# 4. 匯總結果
echo -e "\n[結果匯總]"
grep "結束摘要" "$LOG_FILE" | sed 's/.*結束摘要：//'
