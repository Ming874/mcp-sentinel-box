/*
 * ipc.c - 用 Unix Domain Socket + SCM_RIGHTS 傳遞 fd
 *
 * Linux 容許在不同行程之間透過 Unix socket 的 control message 傳 fd，
 * kernel 會在接收端重新配置一個對應 fd table 的入口。
 * 這是把 seccomp notify_fd 從 sandbox child 傳到 monitor 的標準做法。
 *
 * 傳送端：
 *   - sendmsg 帶 SCM_RIGHTS control message，內含整數 fd。
 * 接收端：
 *   - recvmsg 後從 cmsg buffer 取出新的 fd。
 *
 * 同時帶一段 ASCII 訊息（"NOTIFY_FD"）方便除錯與雙方握手。
 */

#define _GNU_SOURCE
#include "sentinelbox.h"

#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <sys/types.h>

/* 建立 socketpair，雙端皆設 CLOEXEC */
int sb_ipc_make_pair(int sv[2]) {
    if (socketpair(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0, sv) != 0) {
        sb_log_err("socketpair 失敗: %s", strerror(errno));
        return SB_ERR_IPC;
    }
    return SB_OK;
}

/* 透過 sock 傳送 fd 給對端
 * msg 是隨附的純文字（≤ 256 byte），主要供握手與識別 */
int sb_ipc_send_fd(int sock, int fd, const char *msg) {
    char dummy[256];
    size_t mlen = msg ? strlen(msg) : 0;
    if (mlen >= sizeof dummy) mlen = sizeof dummy - 1;
    if (mlen) memcpy(dummy, msg, mlen);
    dummy[mlen] = '\0';

    struct iovec iov = { .iov_base = dummy, .iov_len = mlen + 1 };

    /* control message buffer：CMSG_SPACE(sizeof(int)) 給單一 fd 即可 */
    union {
        struct cmsghdr  align;
        char            buf[CMSG_SPACE(sizeof(int))];
    } u;
    memset(&u, 0, sizeof u);

    struct msghdr hdr = {
        .msg_iov     = &iov,
        .msg_iovlen  = 1,
        .msg_control = u.buf,
        .msg_controllen = sizeof u.buf,
    };
    struct cmsghdr *cmsg = CMSG_FIRSTHDR(&hdr);
    cmsg->cmsg_level = SOL_SOCKET;
    cmsg->cmsg_type  = SCM_RIGHTS;
    cmsg->cmsg_len   = CMSG_LEN(sizeof(int));
    memcpy(CMSG_DATA(cmsg), &fd, sizeof fd);

    ssize_t n = sendmsg(sock, &hdr, 0);
    if (n < 0) {
        sb_log_err("sendmsg(fd=%d) 失敗: %s", fd, strerror(errno));
        return SB_ERR_IPC;
    }
    return SB_OK;
}

/* 從 sock 接收一個 fd */
int sb_ipc_recv_fd(int sock, int *fd_out, char *msg_buf, size_t msg_len) {
    char dummy[256];
    struct iovec iov = { .iov_base = dummy, .iov_len = sizeof dummy };

    union {
        struct cmsghdr  align;
        char            buf[CMSG_SPACE(sizeof(int))];
    } u;
    memset(&u, 0, sizeof u);

    struct msghdr hdr = {
        .msg_iov     = &iov,
        .msg_iovlen  = 1,
        .msg_control = u.buf,
        .msg_controllen = sizeof u.buf,
    };

    ssize_t n = recvmsg(sock, &hdr, 0);
    if (n < 0) {
        sb_log_err("recvmsg 失敗: %s", strerror(errno));
        return SB_ERR_IPC;
    }
    struct cmsghdr *cmsg = CMSG_FIRSTHDR(&hdr);
    if (!cmsg || cmsg->cmsg_level != SOL_SOCKET || cmsg->cmsg_type != SCM_RIGHTS) {
        sb_log_err("control message 缺少 SCM_RIGHTS");
        return SB_ERR_IPC;
    }
    int fd;
    memcpy(&fd, CMSG_DATA(cmsg), sizeof fd);
    *fd_out = fd;

    /* 把附帶訊息複製出去供呼叫端比對 */
    if (msg_buf && msg_len > 0) {
        size_t cp = (size_t)n < msg_len - 1 ? (size_t)n : msg_len - 1;
        memcpy(msg_buf, dummy, cp);
        msg_buf[cp] = '\0';
    }
    return SB_OK;
}
