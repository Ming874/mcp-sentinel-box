/*
 * overlayfs.c - OverlayFS / tmpfs / pivot_root 檔案系統隔離
 *
 * 核心目標：
 *   1. 沙盒內的 rootfs 必須與宿主隔離。
 *   2. 寫入只發生在 RAM-backed tmpfs (upper layer)，因此 reset 是「卸載 tmpfs」即可，
 *      不需任何持久化清理。
 *   3. 用 pivot_root 取代 chroot；pivot_root 強制換掉整個檔案系統根，舊根置於可卸載的子目錄。
 *
 * 掛載拓樸：
 *   merged = overlay(lowerdir=rootfs, upperdir=tmpfs/upper, workdir=tmpfs/work)
 *   newroot = merged
 *   pivot_root(newroot, newroot/oldroot)
 *   umount2(oldroot, MNT_DETACH)
 *
 * 為什麼 lowerdir 唯讀就好：上游 busybox rootfs 不該被沙盒改動，
 * 所有變更會堆到 upperdir（tmpfs），重啟即消失。
 */

#define _GNU_SOURCE
#include "sentinelbox.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/mount.h>
#include <sys/syscall.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <linux/limits.h>

/* pivot_root 是 syscall，glibc 沒包 wrapper，要自己呼叫 */
static int pivot_root_sys(const char *new_root, const char *put_old) {
    return (int)syscall(SYS_pivot_root, new_root, put_old);
}

/* 在 mount namespace 內把整個 / 標為 private propagation，
 * 防止 sandbox 內的 mount 動作洩漏回宿主端。
 * systemd 預設把 / 標成 shared，這步驟省略會造成隔離破口。 */
static int make_root_private(void) {
    if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) != 0) {
        sb_log_err("無法把 / 標為 MS_PRIVATE: %s", strerror(errno));
        return SB_ERR_MOUNT;
    }
    return SB_OK;
}

/* 主流程：建立 tmpfs scratch、組合 overlay、最後 pivot_root */
int sb_ofs_setup(const char *rootfs) {
    if (!rootfs) return SB_ERR_INVAL;
    if (make_root_private() != SB_OK) return SB_ERR_MOUNT;

    /* 1) 在 /tmp/.sentinelbox.<pid> 底下做 scratch 目錄，避免污染宿主 /tmp */
    char scratch[PATH_MAX];
    snprintf(scratch, sizeof scratch, "/tmp/.sentinelbox.%d", (int)getpid());
    if (mkdir(scratch, 0700) != 0 && errno != EEXIST) {
        sb_log_err("mkdir scratch 失敗: %s", strerror(errno));
        return SB_ERR_MOUNT;
    }

    /* 2) 在 scratch 上掛 tmpfs，作為 overlay 的 upper/work 來源
     *    size=128m 限制 tmpfs 上限，避免沙盒寫爆宿主 RAM */
    if (mount("tmpfs", scratch, "tmpfs", MS_NOSUID | MS_NODEV,
              "size=128m,mode=755") != 0) {
        sb_log_err("mount tmpfs 失敗: %s", strerror(errno));
        return SB_ERR_MOUNT;
    }

    /* 3) 建立 overlay 三個必要子目錄 */
    char upper[PATH_MAX], work[PATH_MAX], merged[PATH_MAX], oldroot[PATH_MAX];
    snprintf(upper,  sizeof upper,  "%s/upper",  scratch);
    snprintf(work,   sizeof work,   "%s/work",   scratch);
    snprintf(merged, sizeof merged, "%s/merged", scratch);
    if (mkdir(upper, 0755) != 0 ||
        mkdir(work,  0755) != 0 ||
        mkdir(merged,0755) != 0) {
        sb_log_err("mkdir overlay 子目錄失敗: %s", strerror(errno));
        return SB_ERR_MOUNT;
    }

    /* 4) 組裝 overlay mount options。
     *    lowerdir 為唯讀 rootfs；upper/work 在 tmpfs 上。
     *    overlay 要求 work 與 upper 必須同一個檔案系統。 */
    char ovopt[PATH_MAX * 3 + 64];
    snprintf(ovopt, sizeof ovopt, "lowerdir=%s,upperdir=%s,workdir=%s",
             rootfs, upper, work);
    if (mount("overlay", merged, "overlay", 0, ovopt) != 0) {
        sb_log_err("mount overlay 失敗 (opts=%s): %s", ovopt, strerror(errno));
        return SB_ERR_MOUNT;
    }
    sb_log_info("overlay 掛載完成 -> %s", merged);

    /* 5) pivot_root 之前要先 chdir 到新 root，否則 kernel 拒絕 */
    if (chdir(merged) != 0) {
        sb_log_err("chdir(%s) 失敗: %s", merged, strerror(errno));
        return SB_ERR_MOUNT;
    }

    /* 6) 在新 root 內建立 oldroot 掛載點，pivot_root 需要 */
    if (mkdir("oldroot", 0700) != 0 && errno != EEXIST) {
        sb_log_err("mkdir oldroot 失敗: %s", strerror(errno));
        return SB_ERR_MOUNT;
    }

    /* 7) pivot_root：把目前的 / 換成 merged，舊 / 移到 ./oldroot */
    snprintf(oldroot, sizeof oldroot, "./oldroot");
    if (pivot_root_sys(".", oldroot) != 0) {
        sb_log_err("pivot_root 失敗: %s", strerror(errno));
        return SB_ERR_MOUNT;
    }
    /* pivot_root 後沙盒看到的「/」就是 merged */
    if (chdir("/") != 0) {
        sb_log_err("chdir(/) 失敗: %s", strerror(errno));
        return SB_ERR_MOUNT;
    }

    /* 8) 卸載 oldroot。MNT_DETACH 表示「lazy umount」，
     *    即便還有開啟的檔案描述符也會等它們關閉再真正釋放，
     *    這樣即使 pivot_root 後還有遺留 fd 也能順利進行。 */
    if (umount2("/oldroot", MNT_DETACH) != 0) {
        sb_log_warn("umount oldroot 失敗（後續仍可繼續）: %s", strerror(errno));
    }
    rmdir("/oldroot");

    sb_log_info("pivot_root 完成，沙盒檔案系統已就位");
    return SB_OK;
}

/* 在沙盒內掛載 /proc。
 * 因為我們進入了新的 PID namespace，/proc 必須是「新的」proc 掛載，
 * 否則沙盒內看到的 PID 會是宿主的（資訊洩漏）。 */
int sb_ofs_mount_proc(void) {
    /* /proc 必須先存在 */
    if (mkdir("/proc", 0555) != 0 && errno != EEXIST) {
        sb_log_warn("/proc mkdir: %s", strerror(errno));
    }
    if (mount("proc", "/proc", "proc",
              MS_NOSUID | MS_NODEV | MS_NOEXEC, NULL) != 0) {
        sb_log_err("mount /proc 失敗: %s", strerror(errno));
        return SB_ERR_MOUNT;
    }
    sb_log_info("/proc 已掛載 (PID namespace 視角)");

    /* /dev/null /dev/zero 之類由 lowerdir 提供；
     * 若沙盒需要新 devtmpfs，可在此擴充。 */
    return SB_OK;
}

/* 對外：pivot_root 之後若需單獨呼叫的入口（目前已含在 setup 內） */
int sb_ofs_pivot_root(void) {
    return SB_OK;
}
