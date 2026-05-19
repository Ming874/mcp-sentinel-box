/*
 * capability.c - 沙盒內 Linux capability 縮減
 *
 * 即便沙盒內 uid 0 被對映到宿主普通使用者，
 * 沙盒內仍持有「該 namespace 範圍內」的完整 capability，
 * 例如可在沙盒內 mount、chroot、設 ip 等。
 * 我們進一步丟掉不必要的 cap，把沙盒 root 降到「能跑 user code 但無法搞事」。
 *
 * 同時必須設 PR_SET_NO_NEW_PRIVS = 1：
 *   - 這是 seccomp 在非 CAP_SYS_ADMIN 下安裝 filter 的前置條件。
 *   - 還能阻止 setuid binary 被 exec 後拿到 elevated privilege。
 */

#define _GNU_SOURCE
#include "sentinelbox.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/prctl.h>
#include <sys/capability.h>     /* libcap: cap_get_proc / cap_set_proc */
#include <linux/capability.h>   /* CAP_* 常數 */

/* 設 PR_SET_NO_NEW_PRIVS = 1 */
int sb_cap_set_no_new_privs(void) {
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        sb_log_err("PR_SET_NO_NEW_PRIVS 設定失敗: %s", strerror(errno));
        return SB_ERR_CAP;
    }
    sb_log_info("no_new_privs 已啟用");
    return SB_OK;
}

/* 把所有「危險」cap 從 effective/permitted/inheritable 移除。
 *
 * 為什麼不一律全丟空：
 *   - sandbox child 還需要 CAP_SYS_ADMIN 來做 mount/pivot_root（雖然在 userns 範圍內）。
 *   - 所以我們在 setup 完 fs/cgroup 之後才呼叫本函式，把這些 cap 清掉。
 *
 * 黑名單 vs 白名單：
 *   - 白名單較安全但太嚴格會壞掉沙盒內常見程式（譬如 Python 需要 CAP_AUDIT_WRITE? 不需要）。
 *   - 採黑名單明列高風險 cap，剩餘留給 user code 兼容性。
 */
int sb_cap_drop_dangerous(void) {
    /* 高風險 cap 黑名單；具體效果見 capabilities(7)
     *   CAP_SYS_ADMIN     - 萬能 cap，含 mount / pivot_root / namespace 等
     *   CAP_SYS_MODULE    - 載入 kernel module
     *   CAP_SYS_RAWIO     - 直接存取 ioperm/iopl
     *   CAP_SYS_PTRACE    - ptrace 別的行程
     *   CAP_NET_ADMIN     - 改路由表、防火牆
     *   CAP_NET_RAW       - 開 raw socket（ping、port scan）
     *   CAP_SYS_TIME      - 改系統時間
     *   CAP_SYS_BOOT      - reboot
     *   CAP_MAC_ADMIN     - SELinux/AppArmor 設定
     *   CAP_DAC_OVERRIDE  - 繞過 DAC 權限檢查
     *   CAP_DAC_READ_SEARCH - 繞過讀檔權限
     *   CAP_AUDIT_CONTROL - 改 audit 子系統
     *   CAP_LINUX_IMMUTABLE - 改 immutable bit
     */
    cap_value_t drop[] = {
        CAP_SYS_ADMIN, CAP_SYS_MODULE, CAP_SYS_RAWIO, CAP_SYS_PTRACE,
        CAP_NET_ADMIN, CAP_NET_RAW, CAP_SYS_TIME, CAP_SYS_BOOT,
        CAP_MAC_ADMIN, CAP_DAC_OVERRIDE, CAP_DAC_READ_SEARCH,
        CAP_AUDIT_CONTROL, CAP_LINUX_IMMUTABLE,
    };
    const size_t n_drop = sizeof drop / sizeof drop[0];

    /* 取得目前 cap set；cap_get_proc 回傳新配置的 cap_t，呼叫端需 cap_free */
    cap_t caps = cap_get_proc();
    if (!caps) {
        sb_log_err("cap_get_proc 失敗: %s", strerror(errno));
        return SB_ERR_CAP;
    }

    /* 從 effective/permitted/inheritable 三個集合中清除黑名單 */
    if (cap_set_flag(caps, CAP_EFFECTIVE,    n_drop, drop, CAP_CLEAR) != 0 ||
        cap_set_flag(caps, CAP_PERMITTED,    n_drop, drop, CAP_CLEAR) != 0 ||
        cap_set_flag(caps, CAP_INHERITABLE,  n_drop, drop, CAP_CLEAR) != 0) {
        sb_log_err("cap_set_flag 失敗: %s", strerror(errno));
        cap_free(caps);
        return SB_ERR_CAP;
    }

    /* 套用到本行程 */
    if (cap_set_proc(caps) != 0) {
        sb_log_err("cap_set_proc 失敗: %s", strerror(errno));
        cap_free(caps);
        return SB_ERR_CAP;
    }
    cap_free(caps);

    /* 同時丟掉 bounding set 的高風險 cap，確保 exec 後子行程也不能拿回 */
    for (size_t i = 0; i < n_drop; i++) {
        if (cap_drop_bound(drop[i]) != 0 && errno != EINVAL) {
            sb_log_warn("cap_drop_bound(%d) 失敗: %s", drop[i], strerror(errno));
        }
    }

    sb_log_info("capability 黑名單清除完成 (drop=%zu)", n_drop);
    return SB_OK;
}
