#!/bin/sh
# 惡意樣本：嘗試 mount 檔案系統進行特權提升。
# Strict profile 下 mount syscall 會觸發 KILL。
echo "[mal_mount] 嘗試 mount tmpfs /tmp2 ..."
mkdir -p /tmp2
mount -t tmpfs none /tmp2 || { echo "[mal_mount] 失敗 (預期：被 seccomp 阻擋)"; exit 1; }
