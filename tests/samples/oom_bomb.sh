#!/bin/sh
# 資源耗盡樣本：用 dd 持續分配大區塊到 /dev/null/?? 觸發 cgroup memory.max。
# strict profile 限制 128 MiB；本腳本配 256 MiB 應觸發 OOM Kill。
echo "[oom] 配置記憶體中..."
dd if=/dev/zero of=/tmp/bigfile bs=1M count=256 2>/dev/null || \
  echo "[oom] dd 失敗（預期：cgroup memory.max 觸發 OOM）"
