#!/bin/sh
# telemetry_load.sh - Phase 3 telemetry 取樣負載樣本
#
# 目的：產生一段「可預期時長」的工作負載，讓 monitor 的 cgroup 取樣執行緒
#       （10Hz）能寫入足量的 resource_samples 供 test_telemetry.sh 斷言。
#
# 行為：
#   1. 先做一小段 CPU 自旋，讓 cpu.stat 的 usage_usec 明顯增加（cpu_pct > 0）。
#   2. 再 sleep 3 秒拉長總時長 → 期望 ~30 筆樣本（3s × 10Hz）。
echo "[telemetry-load] start"

# 短暫 CPU 自旋（busybox sh 算術迴圈），製造非零 CPU 使用率
i=0
while [ "$i" -lt 100000 ]; do
  i=$((i + 1))
done
echo "[telemetry-load] cpu burst done, sleeping"

sleep 3
echo "[telemetry-load] done"
