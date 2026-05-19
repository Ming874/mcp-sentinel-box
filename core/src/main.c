/*
 * main.c - sentinelbox CLI 進入點
 *
 * 用法（典型）：
 *   sentinelbox --profile=strict --rootfs=/srv/busybox -- /bin/sh -c "echo hi"
 *
 * 旗標：
 *   --profile=<name>     對應 profiles/<name>.json，預設 strict
 *   --rootfs=<path>      唯讀 rootfs 來源（必填）
 *   --profile-dir=<path> profile JSON 所在目錄，預設 ./profiles
 *   --monitor=<path>     sentinelbox-monitor 執行檔，預設 ./monitor/target/release/sentinelbox-monitor
 *   --cgroup-parent=<p>  cgroup 父路徑，預設 /sys/fs/cgroup
 *   --no-monitor         不啟動 Rust monitor（純 Phase 1 模式，NOTIFY 動作退化為 ERRNO）
 *   -v / --verbose       詳細 log
 *
 * 「-- argv...」之後皆視為要在沙盒內執行的命令。
 */

#define _GNU_SOURCE
#include "sentinelbox.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <getopt.h>
#include <sys/wait.h>
#include <fcntl.h>

static void usage(const char *argv0) {
    fprintf(stderr,
        "SentinelBox - 安全 AI 程式碼執行沙盒 (UNIX 系統程式設計 期末專題)\n"
        "\n"
        "Usage: %s [OPTIONS] -- COMMAND [ARGS...]\n"
        "\n"
        "Options:\n"
        "  --profile=NAME        套用 profiles/NAME.json (預設: strict)\n"
        "  --profile-dir=DIR     profile 目錄 (預設: ./profiles)\n"
        "  --rootfs=PATH         唯讀 rootfs 來源 (必填)\n"
        "  --monitor=PATH        sentinelbox-monitor 執行檔路徑\n"
        "  --cgroup-parent=PATH  cgroup 父路徑 (預設 /sys/fs/cgroup)\n"
        "  --no-monitor          不啟用 monitor，全靠 seccomp ERRNO/KILL 動作\n"
        "  -v, --verbose         詳細 log\n"
        "  -h, --help            顯示本說明\n"
        , argv0);
}

/* 啟動 monitor 子行程；socket fd 透過 dup2 到 fd 3，便於 monitor 規範化讀取 */
static pid_t spawn_monitor(const char *monitor_bin, int sock_for_monitor,
                           const sb_runtime_t *rt) {
    pid_t pid = fork();
    if (pid < 0) {
        sb_log_err("fork monitor 失敗: %s", strerror(errno));
        return -1;
    }
    if (pid == 0) {
        /* monitor child：把 socket dup 到 fd 3，避免依賴特定 fd 號碼 */
        if (sock_for_monitor != 3) {
            if (dup2(sock_for_monitor, 3) < 0) _exit(127);
            close(sock_for_monitor);
        } else {
            /* 已是 fd 3，但要清掉 CLOEXEC 否則 exec 後不見了 */
            int fl = fcntl(3, F_GETFD);
            fcntl(3, F_SETFD, fl & ~FD_CLOEXEC);
        }
        /* 透過環境變數傳遞 cgroup 路徑與 profile 名稱，
         * 讓 monitor 能 sample telemetry 並標記 audit log */
        setenv(SB_ENV_MONITOR_FD, "3", 1);
        setenv("SENTINELBOX_CGROUP", rt->cgroup_path, 1);
        setenv("SENTINELBOX_PROFILE", rt->profile->name, 1);

        execlp(monitor_bin, "sentinelbox-monitor", (char *)NULL);
        sb_log_err("exec monitor(%s) 失敗: %s", monitor_bin, strerror(errno));
        _exit(127);
    }
    return pid;
}

int main(int argc, char **argv) {
    sb_config_t cfg = {
        .profile_name   = "strict",
        .profile_dir    = "./profiles",
        .rootfs_dir     = NULL,
        .monitor_bin    = "./monitor/target/release/sentinelbox-monitor",
        .cgroup_parent  = SB_CGROUP_ROOT,
    };

    /* 解析參數 */
    static struct option longopts[] = {
        { "profile",        required_argument, 0, 'p' },
        { "profile-dir",    required_argument, 0, 'D' },
        { "rootfs",         required_argument, 0, 'r' },
        { "monitor",        required_argument, 0, 'm' },
        { "cgroup-parent",  required_argument, 0, 'C' },
        { "no-monitor",     no_argument,       0, 'N' },
        { "verbose",        no_argument,       0, 'v' },
        { "help",           no_argument,       0, 'h' },
        { 0, 0, 0, 0 }
    };
    int c;
    while ((c = getopt_long(argc, argv, "p:D:r:m:C:Nvh", longopts, NULL)) != -1) {
        switch (c) {
            case 'p': cfg.profile_name  = optarg; break;
            case 'D': cfg.profile_dir   = optarg; break;
            case 'r': cfg.rootfs_dir    = optarg; break;
            case 'm': cfg.monitor_bin   = optarg; break;
            case 'C': cfg.cgroup_parent = optarg; break;
            case 'N': cfg.no_monitor    = 1; break;
            case 'v': cfg.verbose       = 1; break;
            case 'h': usage(argv[0]); return 0;
            default:  usage(argv[0]); return 2;
        }
    }
    if (!cfg.rootfs_dir) {
        fprintf(stderr, "缺少必填參數 --rootfs\n");
        usage(argv[0]);
        return 2;
    }
    if (optind >= argc) {
        fprintf(stderr, "缺少要執行的命令（請在 -- 之後加上 argv）\n");
        return 2;
    }
    cfg.argv = &argv[optind];
    cfg.argc = argc - optind;

    sb_log_init(cfg.verbose);
    sb_log_info("sentinelbox 啟動 (profile=%s, rootfs=%s)",
                cfg.profile_name, cfg.rootfs_dir);

    /* 載入 profile */
    sb_profile_t *p = sb_profile_load(cfg.profile_dir, cfg.profile_name);
    if (!p) {
        fprintf(stderr, "無法載入 profile: %s/%s.json\n", cfg.profile_dir, cfg.profile_name);
        return 1;
    }

    /* 建立 runtime context */
    sb_runtime_t rt = {
        .cfg = &cfg,
        .profile = p,
        .ipc_sock_parent = -1,
        .ipc_sock_child  = -1,
        .monitor_pid     = -1,
    };

    /* 建立 cgroup */
    if (sb_cg_create(&rt) != SB_OK) {
        sb_log_warn("cgroup 建立失敗，繼續執行但無資源限制");
    } else {
        sb_cg_apply_limits(&rt);
    }

    /* 建立 socketpair，給 child↔monitor 傳 notify_fd */
    int sv[2] = { -1, -1 };
    if (sb_ipc_make_pair(sv) != SB_OK) {
        sb_log_err("socketpair 建立失敗");
        sb_profile_free(p);
        return 1;
    }
    rt.ipc_sock_parent = sv[0];      /* 給 sandbox child 用（child fork 自父行程） */
    rt.ipc_sock_child  = sv[0];      /* 共用：sandbox 在 child_entry 內呼叫 send_fd */

    /* 啟動 monitor（除非 --no-monitor） */
    if (!cfg.no_monitor) {
        rt.monitor_pid = spawn_monitor(cfg.monitor_bin, sv[1], &rt);
        if (rt.monitor_pid < 0) {
            sb_log_warn("monitor 啟動失敗，退化為純 seccomp ERRNO 模式");
            cfg.no_monitor = 1;
        }
        /* 父行程不再需要 monitor 那端 */
        close(sv[1]);
        sv[1] = -1;
    } else {
        close(sv[1]);
    }

    /* 跑 sandbox（會等 child 結束） */
    int sandbox_rc = sb_sandbox_run(&rt);

    /* 等 monitor 結束（monitor 應自動偵測 notify_fd EOF 結束） */
    if (rt.monitor_pid > 0) {
        int st;
        if (waitpid(rt.monitor_pid, &st, 0) > 0) {
            sb_log_info("monitor 結束, status=%d", st);
        }
    }

    /* 印出最後資源用量 */
    uint64_t mem = 0, cpu_us = 0;
    sb_cg_read_memory_current(rt.cgroup_path, &mem);
    sb_cg_read_cpu_usage(rt.cgroup_path, &cpu_us);
    fprintf(stderr,
            "[sentinelbox] 結束摘要：sandbox_rc=%d mem_peak~%lu KiB cpu_total=%lu ms\n",
            sandbox_rc, (unsigned long)(mem >> 10), (unsigned long)(cpu_us / 1000));

    /* 清理 cgroup */
    sb_cg_cleanup(rt.cgroup_path);
    sb_profile_free(p);
    if (sv[0] >= 0) close(sv[0]);

    return sandbox_rc;
}
