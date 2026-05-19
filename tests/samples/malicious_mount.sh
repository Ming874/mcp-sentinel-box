#!/bin/sh
# 惡意樣本：嘗試 mount /proc 之外的檔案系統。
# strict profile 下 mount syscall → KILL，行程會被 SIGKILL 終止。
echo "[mal_mount] 嘗試 mount tmpfs /tmp2 ..."
mkdir -p /tmp2
mount -t tmpfs none /tmp2 || echo "[mal_mount] mount 失敗（預期：行程被 SIGKILL）"
