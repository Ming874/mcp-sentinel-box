/*
 * cgroup.c - Cgroup v2 統一階層的資源限制
 *
 * 為什麼必須是 v2：
 *   - v1 各 controller 各自為政，路徑分散、設定複雜，且不支援 rootless delegation。
 *   - v2 unified hierarchy 把所有 controller 放同一棵樹，更容易追蹤。
 *   - User Namespace + cgroup v2 delegation 是 rootless 容器的標準組合。
 *
 * 設定流程：
 *   1. 在 SB_CGROUP_ROOT 下建立 sentinelbox.<pid> 子目錄。
 *   2. 把 sandbox child 加入該 cgroup（寫 cgroup.procs）。
 *   3. 寫入 memory.max / cpu.max / pids.max 等限制。
 *   4. 沙盒結束後 rmdir 清掉 cgroup。
 *
 * 注意：rootless 環境要 cgroup 寫權限，需先做 cgroup delegation。
 *       scripts/setup_cgroup.sh 提供一鍵指令。
 */

#define _GNU_SOURCE
#include "sentinelbox.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/stat.h>
#include <fcntl.h>

/* 寫一個整數到 cgroup interface 檔案；常用於 pids.max 等 */
static int cg_write_int(const char *path, unsigned long long v) {
    char buf[64];
    int n = snprintf(buf, sizeof buf, "%llu\n", v);
    return sb_write_file(path, buf, (size_t)n);
}

/* memory.max 接受 "max" 表示不限制，否則為 byte 數 */
static int cg_write_mem(const char *path, uint64_t bytes) {
    if (bytes == 0) return sb_write_file(path, "max\n", 4);
    return cg_write_int(path, (unsigned long long)bytes);
}

/* cpu.max 格式特殊：「<quota> <period>」或 "max <period>" 表示不限制 */
static int cg_write_cpu_max(const char *path, uint64_t quota, uint64_t period) {
    char buf[64];
    int n;
    if (quota == 0) n = snprintf(buf, sizeof buf, "max %lu\n", (unsigned long)period);
    else            n = snprintf(buf, sizeof buf, "%lu %lu\n", (unsigned long)quota, (unsigned long)period);
    return sb_write_file(path, buf, (size_t)n);
}

/* 建立 cgroup 目錄並寫入 cgroup.subtree_control 啟用 controller。
 * subtree_control 要在父 cgroup 寫，否則子 cgroup 拿不到對應 controller。
 * 這邊我們在 SB_CGROUP_ROOT 下啟用，前提是 root cgroup 已有 +memory +cpu +pids 等。 */
int sb_cg_create(sb_runtime_t *rt) {
    if (!rt || !rt->cfg) return SB_ERR_INVAL;
    const char *parent = rt->cfg->cgroup_parent ? rt->cfg->cgroup_parent : SB_CGROUP_ROOT;
    snprintf(rt->cgroup_path, sizeof rt->cgroup_path,
             "%s/sentinelbox.%d", parent, (int)getpid());

    /* mkdir 即建立一個 cgroup；kernel 看到 sysfs 內的目錄就會生 cgroup 物件 */
    if (mkdir(rt->cgroup_path, 0755) != 0 && errno != EEXIST) {
        sb_log_err("建立 cgroup 失敗 %s: %s (是否已做 cgroup delegation？)",
                   rt->cgroup_path, strerror(errno));
        return SB_ERR_CGROUP;
    }
    sb_log_info("cgroup 建立完成: %s", rt->cgroup_path);
    return SB_OK;
}

/* 依 profile 寫入限制檔 */
int sb_cg_apply_limits(sb_runtime_t *rt) {
    if (!rt || !rt->profile) return SB_ERR_INVAL;
    char path[SB_MAX_CGROUP_PATH + 32];

    /* memory.max */
    snprintf(path, sizeof path, "%s/memory.max", rt->cgroup_path);
    if (cg_write_mem(path, rt->profile->mem_limit_bytes) != SB_OK) {
        sb_log_warn("寫 memory.max 失敗（可能 controller 未 enabled）");
    }

    /* cpu.max */
    snprintf(path, sizeof path, "%s/cpu.max", rt->cgroup_path);
    if (cg_write_cpu_max(path, rt->profile->cpu_max_quota, rt->profile->cpu_max_period) != SB_OK) {
        sb_log_warn("寫 cpu.max 失敗");
    }

    /* pids.max - 避免 fork bomb */
    snprintf(path, sizeof path, "%s/pids.max", rt->cgroup_path);
    if (cg_write_int(path, rt->profile->pids_max) != SB_OK) {
        sb_log_warn("寫 pids.max 失敗");
    }

    sb_log_info("cgroup 限制套用完成 (mem=%lu B, cpu=%lu/%lu us, pids=%u)",
                (unsigned long)rt->profile->mem_limit_bytes,
                (unsigned long)rt->profile->cpu_max_quota,
                (unsigned long)rt->profile->cpu_max_period,
                rt->profile->pids_max);
    return SB_OK;
}

/* 把 pid 加入 cgroup（寫 cgroup.procs）
 * 必須一行一個 pid；本系統一次加 sandbox child 一個 pid 就好 */
int sb_cg_attach(const char *cgroup_path, pid_t pid) {
    char path[SB_MAX_CGROUP_PATH + 32];
    snprintf(path, sizeof path, "%s/cgroup.procs", cgroup_path);
    char val[32];
    int n = snprintf(val, sizeof val, "%d\n", (int)pid);
    return sb_write_file(path, val, (size_t)n);
}

/* 清理：rmdir cgroup（cgroup 內必須沒有任何行程） */
int sb_cg_cleanup(const char *cgroup_path) {
    if (!cgroup_path) return SB_OK;
    if (rmdir(cgroup_path) != 0) {
        sb_log_warn("rmdir cgroup %s 失敗: %s", cgroup_path, strerror(errno));
        return SB_ERR_CGROUP;
    }
    return SB_OK;
}

/* 讀取目前記憶體用量；給 telemetry / 結束報告用 */
int sb_cg_read_memory_current(const char *cgroup_path, uint64_t *out) {
    char path[SB_MAX_CGROUP_PATH + 32], buf[64];
    snprintf(path, sizeof path, "%s/memory.current", cgroup_path);
    if (sb_read_file(path, buf, sizeof buf) <= 0) return SB_ERR_GENERIC;
    *out = strtoull(buf, NULL, 10);
    return SB_OK;
}

/* 讀取 CPU 總用量（微秒）；cpu.stat 第一行為 "usage_usec <num>" */
int sb_cg_read_cpu_usage(const char *cgroup_path, uint64_t *usec_out) {
    char path[SB_MAX_CGROUP_PATH + 32], buf[256];
    snprintf(path, sizeof path, "%s/cpu.stat", cgroup_path);
    if (sb_read_file(path, buf, sizeof buf) <= 0) return SB_ERR_GENERIC;
    /* 解析「usage_usec <number>」 */
    char *p = strstr(buf, "usage_usec");
    if (!p) return SB_ERR_GENERIC;
    p += strlen("usage_usec");
    while (*p == ' ' || *p == '\t') p++;
    *usec_out = strtoull(p, NULL, 10);
    return SB_OK;
}
