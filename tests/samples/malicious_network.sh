#!/bin/sh
# 惡意樣本：嘗試對外建立 TCP socket。strict profile 下應被 NOTIFY，
# monitor 回 EPERM，沙盒看到「Permission denied」並印出 semantic feedback。
#
# 注意：busybox 內建 nc 不一定能完整實作 connect，這裡盡量壓低相依。
echo "[mal_net] 嘗試 nc 連線 example.com:80 ..."
echo GET / | nc -w 2 example.com 80 || echo "[mal_net] 連線失敗（預期：被 SentinelBox 攔截）"
