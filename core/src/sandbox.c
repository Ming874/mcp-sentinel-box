/*
 * sandbox.c - 沙盒主流程：clone() 出 child 並逐步建立隔離環境
 *
 * 整體序列（父→子→父→子→exec）：
 *   父端
 *     1. socketpair (sv[0]: parent 端、sv[1]: 給 monitor)
 *     2. fork + exec sentinelbox-monitor，傳 sv[1] 為 fd 3
 *     3. pipe2(sync_pipe) 給父子同步
 *     4. clone() child，flags 含所有 namespace；child 進入新 namespace
 *     5. 父寫 setgroups/uid_map/gid_map，並寫 1 byte 到 sync_pipe 通知 child 繼續
 *     6. 父加 child 到 cgroup
 *     7. waitpid child
 *
 *   子端 (在新 namespaces 中執行)
 *     a. 從 sync_pipe 讀 1 byte (block 等父寫 uid_map)
 *     b. setuid/setgid 切到沙盒內 uid 0
 *     c. ofs_setup: tmpfs + overlay + pivot_root
 *     d. ofs_mount_proc: 掛新的 /proc
 *     e. set_hostname
 *     f. set_no_new_privs
 *     g. cap_drop_dangerous
 *     h. seccomp_install → notify_fd
 *     i. ipc_send_fd(sv[0], notify_fd) → 透過 socket 傳給 monitor
 *     j. close 不需要的 fd
 *     k. execvp(target)
 *
 * 注意：把 fd 傳給 monitor 用「父→monitor」的 socket，
 * 由 child 自己 sendmsg 是因為 notify_fd 只在 child 內部建立；
 * monitor 端在 fd 3 等收。
 */

#define _GNU_SOURCE
#include "sentinelbox.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <sched.h>           /* CLONE_NEW* 與 clone() */
#include <signal.h>
#include <sys/wait.h>
#include <sys/syscall.h>
#include <sys/prctl.h>
#include <sys/socket.h>

/* CLONE_NEWCGROUP 在 Linux 4.6+ 才加入；舊版 glibc header 未必有，補定義保險 */
#ifndef CLONE_NEWCGROUP
#define CLONE_NEWCGROUP 0x02000000
#endif

/* clone() 用的 child stack（static，避免每次 malloc） */
static char g_child_stack[SB_CHILD_STACK_SIZE] __attribute__((aligned(16)));

/* 子行程入口函式（在 clone 後執行）
 * 注意：clone child 之後不能用 stdio 之類涉及 mutex 的功能直到 mount 結束，
 * 否則 namespace 切換期間可能因 lock 互斥導致 hang；改用 write(2) + 簡短訊息。 */
static int child_entry(void *arg) {
    sb_runtime_t *rt = (sb_runtime_t *)arg;

    /* Step a: 從 sync_pipe 讀 1 byte，等父行程寫好 uid_map/gid_map */
    close(rt->sync_pipe[1]);                            /* 子不寫 sync_pipe */
    char ch;
    if (read(rt->sync_pipe[0], &ch, 1) != 1) {
        sb_log_err("child: sync_pipe read 失敗，父行程未通知");
        _exit(1);
    }
    close(rt->sync_pipe[0]);

    /* Step b: uid_map 已寫好，現在可以變成沙盒內 root */
    if (setresuid(0, 0, 0) != 0 || setresgid(0, 0, 0) != 0) {
        sb_log_err("child: setresuid/gid 失敗: %s", strerror(errno));
        _exit(1);
    }

    /* Step c: 設定 overlay + pivot_root */
    if (sb_ofs_setup(rt->cfg->rootfs_dir) != SB_OK) {
        sb_log_err("child: overlay 設定失敗");
        _exit(1);
    }

    /* Step d: 驗證 /proc（實際掛載已在 sb_ofs_setup() 於 pivot_root 前完成）。
     * 非致命：巢狀環境若連 rbind 都失敗，不需要 /proc 的程式（echo / nc 等）
     * 仍能正常執行，不該因此整個沙盒中止。 */
    if (sb_ofs_mount_proc() != SB_OK) {
        sb_log_warn("child: /proc 不可用，繼續執行（不依賴 /proc 的程式仍可跑）");
    }

    /* Step e: 設定 hostname 純視覺效果 */
    sb_ns_set_hostname("sentinelbox");

    /* Step f-g: no_new_privs + capability 黑名單 */
    if (sb_cap_set_no_new_privs() != SB_OK) _exit(1);
    if (sb_cap_drop_dangerous() != SB_OK)    _exit(1);

    /* Step h: 安裝 seccomp filter，取得 notify_fd */
    int notify_fd = -1;
    if (sb_seccomp_install(rt->profile, &notify_fd) != SB_OK) {
        sb_log_err("child: seccomp 安裝失敗");
        _exit(1);
    }

    /* Step i: 透過 sv[0] 把 notify_fd 傳給 monitor
     *
     * 重要 invariant：這裡用 sendmsg(SCM_RIGHTS) 傳 fd，而此時 seccomp filter
     * 已生效。因此 profile 內【絕對不能】把 sendmsg 設成 NOTIFY，否則 child 自己的
     * 這個 sendmsg 會被自己的 filter 攔住、等 monitor 回應，但 monitor 還在等收這個
     * fd → 互鎖（見 seccomp_unotify(2) 對 bootstrap syscall 的警告，及 profiles/*.json）。
     * 網路偵測改攔 socket/connect/bind/listen/accept 即可，不需攔 sendmsg。 */
    if (rt->ipc_sock_child >= 0) {
        if (sb_ipc_send_fd(rt->ipc_sock_child, notify_fd, "NOTIFY_FD") != SB_OK) {
            sb_log_err("child: 傳遞 notify_fd 失敗");
            /* 不一定要中斷，但 monitor 收不到 fd 就無法執行 user notification 路徑；
             * 我們選擇繼續執行（profile 內的 ERRNO/KILL 規則仍會生效）。 */
        }
        close(rt->ipc_sock_child);
    }
    /* 子端自己持有的 notify_fd 可以 close，kernel 仍透過 monitor 那份保持有效 */
    close(notify_fd);

    /* Step k: execve 目標。
     * 若是 --code，目標已被父行程寫到 tmpfile 並當作 argv 傳進來；
     * 若是 --file，直接執行該檔。 */
    if (!rt->cfg->argv || rt->cfg->argc == 0) {
        sb_log_err("child: 無 argv 可執行");
        _exit(1);
    }
    sb_log_info("child: execvp(%s)", rt->cfg->argv[0]);
    execvp(rt->cfg->argv[0], rt->cfg->argv);
    /* exec 不該回來 */
    sb_log_err("child: execvp(%s) 失敗: %s", rt->cfg->argv[0], strerror(errno));
    _exit(127);
    return 0;
}

/* 父端：寫 uid/gid map，並通知 child 繼續 */
static int parent_setup_userns(sb_runtime_t *rt) {
    /* 必須先 setgroups=deny 才能寫 gid_map (kernel ≥ 3.19) */
    if (sb_ns_disable_setgroups(rt->sandbox_pid) != SB_OK) return SB_ERR_NS;
    if (sb_ns_write_uid_map(rt->sandbox_pid, getuid()) != SB_OK) return SB_ERR_NS;
    if (sb_ns_write_gid_map(rt->sandbox_pid, getgid()) != SB_OK) return SB_ERR_NS;
    return SB_OK;
}

/* 主流程：clone child → 父端設定 → 等待 child 結束 */
int sb_sandbox_run(sb_runtime_t *rt) {
    if (!rt || !rt->cfg || !rt->profile) return SB_ERR_INVAL;

    /* 建立同步用 pipe（父寫子讀） */
    if (pipe2(rt->sync_pipe, O_CLOEXEC) != 0) {
        sb_log_err("pipe2 失敗: %s", strerror(errno));
        return SB_ERR_GENERIC;
    }

    /* clone flags：所有 namespace 一次到位
     *   CLONE_NEWUSER   - user namespace，使 sandbox root 對應宿主非特權使用者
     *   CLONE_NEWPID    - PID namespace，沙盒內看不到宿主 PID
     *   CLONE_NEWNS     - mount namespace，掛載動作不影響宿主
     *   CLONE_NEWNET    - network namespace，沙盒預設沒有任何網路介面（loopback 也需手動建）
     *   CLONE_NEWUTS    - UTS namespace，可獨立設 hostname
     *   CLONE_NEWIPC    - IPC namespace，shm/msg queue 與宿主隔離
     *   CLONE_NEWCGROUP - cgroup namespace，沙盒內 /proc/self/cgroup 顯示為根
     *   SIGCHLD         - child 結束時對父送 SIGCHLD，方便 waitpid */
    int flags = CLONE_NEWUSER | CLONE_NEWPID | CLONE_NEWNS |
                CLONE_NEWNET  | CLONE_NEWUTS | CLONE_NEWIPC |
                CLONE_NEWCGROUP | SIGCHLD;

    /* stack 指針：x86_64 stack 向下成長，傳「stack 高位元組」 */
    char *stack_top = g_child_stack + SB_CHILD_STACK_SIZE;
    pid_t pid = clone(child_entry, stack_top, flags, rt);
    if (pid < 0) {
        sb_log_err("clone 失敗: %s (rootless 容器需 user namespace 支援，"
                   "確認 /proc/sys/kernel/unprivileged_userns_clone=1)", strerror(errno));
        return SB_ERR_NS;
    }
    rt->sandbox_pid = pid;
    sb_log_info("clone child pid=%d", (int)pid);

    /* 父行程：寫 uid_map，然後通知 child */
    if (parent_setup_userns(rt) != SB_OK) {
        kill(pid, SIGKILL);
        waitpid(pid, NULL, 0);
        return SB_ERR_NS;
    }

    /* 把 child 加入 cgroup（在 child 開始重設 fs 之前完成最保險） */
    if (sb_cg_attach(rt->cgroup_path, pid) != SB_OK) {
        sb_log_warn("無法把 child 加入 cgroup（可能 delegation 未設定）");
    }

    /* 通知 child 可以繼續了：寫 1 byte 到 sync_pipe */
    close(rt->sync_pipe[0]);                                /* 父不讀 */
    if (write(rt->sync_pipe[1], "G", 1) != 1) {             /* "G" for Go */
        sb_log_err("通知 child 失敗: %s", strerror(errno));
        kill(pid, SIGKILL);
    }
    close(rt->sync_pipe[1]);

    /* 等 child 結束 */
    int status = 0;
    if (waitpid(pid, &status, 0) < 0) {
        sb_log_err("waitpid 失敗: %s", strerror(errno));
        return SB_ERR_GENERIC;
    }
    if (WIFEXITED(status)) {
        sb_log_info("sandbox child 正常結束, exit=%d", WEXITSTATUS(status));
    } else if (WIFSIGNALED(status)) {
        sb_log_info("sandbox child 被訊號終止, signal=%d (SIGSYS=31?)",
                    WTERMSIG(status));
    }

    /* 釋放 cgroup（呼叫端可能還想讀統計，故 cleanup 留到 main 處理） */
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
