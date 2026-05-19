#!/bin/sh
# 良性樣本：純列印；應在所有 profile 下成功執行
echo "[sample] hello from inside sandbox"
echo "[sample] uname=$(uname -a 2>/dev/null || echo unknown)"
echo "[sample] uid=$(id -u 2>/dev/null || echo ?) gid=$(id -g 2>/dev/null || echo ?)"
