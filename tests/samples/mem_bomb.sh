#!/bin/sh
# mem_bomb.sh - cgroup memory.max 強制力證據樣本
#
# strict profile 的 memory.max = 128 MiB。本樣本嘗試在 shell 進程內配置
# ~200 MiB 的「匿名記憶體」(用 command substitution 把資料留在進程記憶體，
# 不像檔案 page cache 可被回收)，因此一定會撞穿 128 MiB 上限。
#
# 預期(cgroup 生效時):進程在印出 "alloc done" 之前就被 cgroup OOM 殺掉，
#   沙盒回傳非 0(通常 137 = 128+SIGKILL)。
# 若看得到 "alloc done"，代表 cgroup 沒限制住(fallback / 未授權)。
echo "[mem-bomb] 嘗試配置 ~200MiB 匿名記憶體 (limit=128MiB)..."
X=$(head -c 209715200 /dev/zero | tr '\0' 'a')
echo "[mem-bomb] alloc done len=${#X}  ← 看到這行代表沒被 OOM(cgroup 未限制)"
