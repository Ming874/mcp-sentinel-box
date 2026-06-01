#!/bin/sh
# 資源耗盡樣本：持續分配記憶體直到觸發 cgroup 限制。
# Strict profile 限制 128 MiB；本腳本嘗試配置 256 MiB。
echo "[oom] 開始大量配置記憶體 (dd)..."
dd if=/dev/zero of=/tmp/bigfile bs=1M count=256 2>/dev/null || \
  echo "[oom] dd 失敗 (預期：觸發 OOM Kill)"
