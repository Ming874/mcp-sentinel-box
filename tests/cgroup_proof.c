/*
 * cgroup_proof.c - 直接呼叫 SentinelBox 自家 cgroup.c 證明 cgroup 限制生效
 *
 * 為什麼需要這支：
 *   完整沙盒(sandbox.c)用 CLONE_NEWUSER，在禁止巢狀 user namespace 的環境
 *   (RunPod / 多數容器)會在 clone() 失敗，導致連 cgroup 都驗不到。
 *   但 cgroup 功能(core/src/cgroup.c)其實跟 user namespace 無關，本程式
 *   直接呼叫 sb_cg_create / sb_cg_apply_limits / sb_cg_attach /
 *   sb_cg_read_memory_current / sb_cg_read_cpu_usage —— 全是專案自家函式 ——
 *   建一個 memory.max=128MiB 的 cgroup，放一個會吃 300MiB 的子行程進去，
 *   證明：(1) 限制被強制(子行程 OOM 被殺) (2) telemetry 讀數正確(mem 卡在上限)。
 *
 * 用法：  cgroup_proof <parent_cgroup>      // 例 /sys/fs/cgroup
 *   parent 需已 enable +memory(由 test_cgroup_direct.sh 負責)。
 *
 * exit code: 0=證據成立  1=證據不成立  2=環境不支援(無法建/限制 cgroup)
 */
#define _GNU_SOURCE
#include "sentinelbox.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/types.h>
#include <inttypes.h>

#define LIMIT_BYTES  (128ULL * 1024 * 1024)   /* strict memory.max = 128MiB */
#define BOMB_BYTES   (300ULL * 1024 * 1024)   /* 子行程嘗試吃 300MiB */
#define CHUNK        (4ULL   * 1024 * 1024)   /* 每次配 4MiB 並 memset 觸頁 */

/* 讀 cgroup memory.events 的 oom_kill 計數(cgroup OOM 的鐵證) */
static long read_oom_kill(const char *cg) {
    char path[SB_MAX_CGROUP_PATH + 32];
    snprintf(path, sizeof path, "%s/memory.events", cg);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    char key[64]; long val, oom = 0;
    while (fscanf(f, "%63s %ld", key, &val) == 2)
        if (strcmp(key, "oom_kill") == 0) oom = val;
    fclose(f);
    return oom;
}

int main(int argc, char **argv) {
    sb_log_init(1);
    const char *parent = (argc > 1) ? argv[1] : SB_CGROUP_ROOT;

    /* 組 profile：strict 的資源限制 */
    sb_profile_t prof; memset(&prof, 0, sizeof prof);
    snprintf(prof.name, sizeof prof.name, "%s", "strict");
    prof.mem_limit_bytes = LIMIT_BYTES;
    prof.cpu_max_quota   = 50000;
    prof.cpu_max_period  = 100000;
    prof.pids_max        = 32;

    sb_config_t cfg; memset(&cfg, 0, sizeof cfg);
    cfg.cgroup_parent = parent;

    sb_runtime_t rt; memset(&rt, 0, sizeof rt);
    rt.cfg = &cfg; rt.profile = &prof;

    printf("\n=== 用 SentinelBox 自家 cgroup.c 建立受限 cgroup ===\n");
    printf("parent=%s  limit=%.0f MiB\n", parent, (double)LIMIT_BYTES/1024/1024);

    /* 1) 你的 sb_cg_create + sb_cg_apply_limits */
    if (sb_cg_create(&rt) != SB_OK) {
        fprintf(stderr, "[結論] 無法建立 cgroup(parent 不可寫 / 未 delegation)→ 環境不支援\n");
        return 2;
    }
    sb_cg_apply_limits(&rt);

    /* 確認 memory.max 真的被寫進去(沒寫進去代表 parent 沒 enable memory controller) */
    char mpath[SB_MAX_CGROUP_PATH + 32]; char buf[64] = {0};
    snprintf(mpath, sizeof mpath, "%s/memory.max", rt.cgroup_path);
    if (sb_read_file(mpath, buf, sizeof buf) > 0) {
        printf("memory.max 現值 = %s", buf);
        if (strncmp(buf, "max", 3) == 0) {
            fprintf(stderr, "[結論] memory.max 仍為 'max'(parent 未 enable +memory)→ 環境不支援\n");
            sb_cg_cleanup(rt.cgroup_path);
            return 2;
        }
    }

    /* 2) fork 子行程 → 自己加入 cgroup → 嘗試吃 300MiB */
    pid_t pid = fork();
    if (pid == 0) {
        if (sb_cg_attach(rt.cgroup_path, getpid()) != SB_OK) {
            fprintf(stderr, "child: 無法加入 cgroup\n");
            _exit(3);
        }
        fprintf(stderr, "child: 已進入 cgroup，開始配置記憶體...\n");
        uint64_t got = 0;
        while (got < BOMB_BYTES) {
            char *p = malloc(CHUNK);
            if (!p) { fprintf(stderr, "child: malloc 失敗\n"); _exit(4); }
            memset(p, 'a', CHUNK);          /* 觸頁，讓記憶體真的被 cgroup 計入 */
            got += CHUNK;
            usleep(20000);                  /* 20ms：讓 10Hz 取樣抓到爬升 */
        }
        fprintf(stderr, "child: 配置完 %"PRIu64" MiB 仍存活 ← cgroup 沒限制住!\n",
                got/1024/1024);
        _exit(0);
    }

    /* 3) 父行程：每 100ms 用你的 reader 取樣(模擬 telemetry.rs)直到子行程結束 */
    uint64_t mem_peak = 0, cpu_us = 0; int status = 0; int samples = 0;
    for (;;) {
        pid_t r = waitpid(pid, &status, WNOHANG);
        if (r == pid) break;
        uint64_t mem = 0, cpu = 0;
        if (sb_cg_read_memory_current(rt.cgroup_path, &mem) == SB_OK) {
            if (mem > mem_peak) mem_peak = mem;
        }
        if (sb_cg_read_cpu_usage(rt.cgroup_path, &cpu) == SB_OK) cpu_us = cpu;
        samples++;
        if (samples % 3 == 0)
            printf("  sample#%-3d mem.current=%.1f MiB  cpu=%"PRIu64" us\n",
                   samples, (double)mem/1024/1024, cpu);
        usleep(100000);
    }

    long oom = read_oom_kill(rt.cgroup_path);
    int killed = WIFSIGNALED(status);
    int sig = killed ? WTERMSIG(status) : 0;

    printf("\n=== 結果 ===\n");
    printf("樣本數              = %d (每 100ms 一次)\n", samples);
    printf("mem.current 峰值    = %.1f MiB  (上限 %.0f MiB)\n",
           (double)mem_peak/1024/1024, (double)LIMIT_BYTES/1024/1024);
    printf("cpu 累計            = %"PRIu64" us\n", cpu_us);
    printf("子行程結束方式      = %s%s\n",
           killed ? "被訊號殺(SIGNAL " : "正常退出(exit ",
           killed ? (sig==9?"9/SIGKILL)":"?)") : "0)");
    printf("memory.events oom_kill = %ld\n", oom);

    sb_cg_cleanup(rt.cgroup_path);

    /* 4) 判定證據 */
    int ok_killed = killed && sig == 9;          /* 被 OOM SIGKILL */
    int ok_oom    = oom > 0;                      /* cgroup 記了 OOM */
    int ok_capped = mem_peak <= (uint64_t)(LIMIT_BYTES * 1.10)  /* 沒衝破上限 */
                 && mem_peak >= (uint64_t)(LIMIT_BYTES * 0.50);  /* 確實逼近上限 */

    printf("\n");
    printf("[%s] 子行程被 cgroup OOM 殺掉 (SIGKILL)\n", ok_killed?"PASS":"FAIL");
    printf("[%s] memory.events.oom_kill > 0 (kernel 記錄了 cgroup OOM)\n", ok_oom?"PASS":"FAIL");
    printf("[%s] mem 峰值卡在上限附近 (%.1f MiB ≈ 128 MiB，沒衝破)\n",
           ok_capped?"PASS":"FAIL", (double)mem_peak/1024/1024);

    if (ok_killed && ok_oom && ok_capped) {
        printf("\n==== 證據成立：你的 cgroup.c 確實把 memory.max(128MiB) 強制生效 ====\n");
        printf("     300MiB 配置被 cgroup OOM 攔截，自家 reader 抓到 mem 卡在上限。\n");
        return 0;
    }
    printf("\n==== 證據不成立 ====\n");
    return 1;
}
