/*
 * namespace.c - User Namespace 對映與相關設定
 *
 * Rootless 沙盒的關鍵：
 *   1. 在 clone() 時帶 CLONE_NEWUSER，建立獨立 user namespace。
 *   2. 子行程進入新 namespace 後 uid/gid 會是 65534 (overflow uid)，
 *      此時尚無權限做大多數操作；需由父行程寫入 uid_map / gid_map。
 *   3. 寫 uid_map 前必須先寫 /proc/{pid}/setgroups = "deny"，
 *      否則 kernel 拒絕未授權的 setgroups()，導致 gid_map 寫不進去
 *      （Linux 3.19+ 規定，避免 group lookup 攻擊）。
 *
 * 對映規則：把宿主的真實 uid/gid 映射到沙盒內的 uid 0 / gid 0。
 * 這樣沙盒內 "root" 在宿主端只是普通使用者，無法越權做事。
 */

#define _GNU_SOURCE
#include "sentinelbox.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/syscall.h>
#include <sched.h>           /* CLONE_* flags */

/* 寫 /proc/<pid>/uid_map
 * 格式：「inside_uid host_uid count」
 * 例：「0 1000 1」表示沙盒內 uid 0 對映到宿主端 uid 1000，僅一個 ID。
 */
int sb_ns_write_uid_map(pid_t pid, uid_t host_uid) {
    char path[64], mapping[128];
    snprintf(path, sizeof path, "/proc/%d/uid_map", (int)pid);
    int n = snprintf(mapping, sizeof mapping, "0 %u 1\n", (unsigned)host_uid);
    sb_log_info("寫入 uid_map(%s): %s", path, mapping);
    return sb_write_file(path, mapping, (size_t)n);
}

/* 寫 /proc/<pid>/gid_map；寫之前須先把 setgroups 設為 deny */
int sb_ns_write_gid_map(pid_t pid, gid_t host_gid) {
    char path[64], mapping[128];
    snprintf(path, sizeof path, "/proc/%d/gid_map", (int)pid);
    int n = snprintf(mapping, sizeof mapping, "0 %u 1\n", (unsigned)host_gid);
    sb_log_info("寫入 gid_map(%s): %s", path, mapping);
    return sb_write_file(path, mapping, (size_t)n);
}

/* 寫 /proc/<pid>/setgroups = "deny"
 * Linux 3.19 起新增的安全閘門，必須在寫 gid_map 之前呼叫，
 * 否則 gid_map 寫入會被 EPERM 拒絕。 */
int sb_ns_disable_setgroups(pid_t pid) {
    char path[64];
    snprintf(path, sizeof path, "/proc/%d/setgroups", (int)pid);
    const char *deny = "deny";
    return sb_write_file(path, deny, 4);
}

/* 在 UTS namespace 內設定 hostname；
 * 純粹是「沙盒裡看起來像獨立主機」的視覺效果，與隔離安全性無關，
 * 但對 demo / 識別有幫助（uname -n 會回傳這個名字） */
int sb_ns_set_hostname(const char *name) {
    if (!name) return SB_ERR_INVAL;
    /* sethostname() 需要 CAP_SYS_ADMIN，沙盒內有完整的 namespace cap 故可行 */
    if (sethostname(name, strlen(name)) != 0) {
        sb_log_warn("sethostname 失敗（可忽略）: %s", strerror(errno));
        return SB_ERR_NS;
    }
    return SB_OK;
}
