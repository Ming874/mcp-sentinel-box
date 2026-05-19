/*
 * seccomp.c - SECCOMP_RET_USER_NOTIF filter 安裝
 *
 * 為什麼用 SECCOMP_RET_USER_NOTIF 而非 SECCOMP_RET_TRACE (ptrace)：
 *   - ptrace 每次攔截要做兩次 context switch (kernel <-> tracer)，延遲高。
 *   - USER_NOTIF (Linux 5.0+) 透過專用 fd 傳遞 notification，
 *     kernel 把 syscall 暫停在 kernel-side，待 monitor 處理完透過 fd 回應；
 *     ioctl 來回只需要一次 syscall，延遲降低 ~80%。
 *
 * 安裝流程：
 *   1. ctx = seccomp_init(default_action)
 *   2. 對每條 profile rule 呼叫 seccomp_rule_add(ctx, action, syscall_nr, ...)
 *      將 NOTIFY 動作鎖定到該 syscall。
 *   3. 設 SCMP_FLTATR_NEW_LISTENER=1，seccomp_load 會自動建立 listener。
 *   4. seccomp_notify_fd(ctx) 取得 fd，回傳給呼叫端。
 *   5. fd 會透過 SCM_RIGHTS 傳給 Rust monitor。
 *
 * 安裝後本行程的 syscall 才會經由 filter；
 * 呼叫順序：先 set_no_new_privs，再 cap_drop，再 seccomp_install，再 execve。
 */

#define _GNU_SOURCE
#include "sentinelbox.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <seccomp.h>

/* 把 sb_action_t 轉成 libseccomp 的 SCMP_ACT_* 巨集 */
static uint32_t to_scmp_action(sb_action_t a, int errno_value) {
    switch (a) {
        case SB_ACT_ALLOW:  return SCMP_ACT_ALLOW;
        case SB_ACT_ERRNO:  return SCMP_ACT_ERRNO((uint32_t)errno_value);
        case SB_ACT_NOTIFY: return SCMP_ACT_NOTIFY;
        case SB_ACT_KILL:   return SCMP_ACT_KILL_PROCESS;
        default:            return SCMP_ACT_KILL_PROCESS;
    }
}

/* 對外：根據 profile 安裝 seccomp filter，並回傳 listener fd */
int sb_seccomp_install(const sb_profile_t *p, int *listener_fd_out) {
    if (!p || !listener_fd_out) return SB_ERR_INVAL;

    /* 1) 以 default_action 為基底建立 filter context */
    uint32_t def = to_scmp_action(p->default_action, EPERM);
    scmp_filter_ctx ctx = seccomp_init(def);
    if (!ctx) {
        sb_log_err("seccomp_init 失敗");
        return SB_ERR_SECCOMP;
    }

    /* 2) 對每條 rule 加進 filter
     *    seccomp_rule_add 簽名: (ctx, action, syscall, arg_cnt, ...)
     *    arg_cnt=0 表不對 syscall 參數做額外比對，整個 syscall 一律走此 action */
    for (size_t i = 0; i < p->rule_count; i++) {
        uint32_t act = to_scmp_action(p->rules[i].action, p->rules[i].errno_value);
        int rc = seccomp_rule_add(ctx, act, p->rules[i].syscall_nr, 0);
        if (rc != 0) {
            /* libseccomp 對部分 syscall 在某架構上不存在會回 -EFAULT/-EINVAL；
             * 列為 warn 而非 fatal，避免一個 platform-specific syscall 害整個 filter 起不來 */
            sb_log_warn("seccomp_rule_add(syscall=%d) 失敗: rc=%d",
                        p->rules[i].syscall_nr, rc);
        }
    }

    /* 3) 設定 NEW_LISTENER 屬性，使 seccomp_load 自動建立 user notification fd */
    if (seccomp_attr_set(ctx, SCMP_FLTATR_NEW_LISTENER, 1) != 0) {
        sb_log_err("SCMP_FLTATR_NEW_LISTENER 設定失敗");
        seccomp_release(ctx);
        return SB_ERR_SECCOMP;
    }

    /* 4) 載入 filter。
     *    呼叫前已 setno_new_privs(1)；否則 unprivileged 載入會被拒。 */
    int rc = seccomp_load(ctx);
    if (rc != 0) {
        sb_log_err("seccomp_load 失敗: rc=%d (no_new_privs 是否已啟用？)", rc);
        seccomp_release(ctx);
        return SB_ERR_SECCOMP;
    }

    /* 5) 取得 notification fd。回傳值 >= 0 為合法 fd。 */
    int fd = seccomp_notify_fd(ctx);
    if (fd < 0) {
        sb_log_err("seccomp_notify_fd 取得失敗: %d", fd);
        seccomp_release(ctx);
        return SB_ERR_SECCOMP;
    }
    /* ctx 釋放後 filter 仍生效，但 listener fd 仍由 kernel 持有；
     * 我們不能 release ctx 之前 close(fd)。先 release ctx 即可（fd 是獨立的）。 */
    seccomp_release(ctx);

    *listener_fd_out = fd;
    sb_log_info("seccomp listener 已建立，notify_fd=%d", fd);
    return SB_OK;
}
