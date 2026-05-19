/*
 * util.c - 共用工具：log 與小型檔案 IO 輔助
 *
 * 設計考量：
 *   - log 走 stderr，避免污染 stdout（sandbox 內目標程式的標準輸出）。
 *   - 不引入 syslog；本系統屬獨立工具，直接寫 stderr 簡單可控。
 *   - 寫檔輔助封裝 write() 的部分寫入迴圈，呼叫端不必自己處理。
 */

#define _GNU_SOURCE         /* 讓 <fcntl.h> 暴露 O_CLOEXEC 等旗標 */
#include "sentinelbox.h"

#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <time.h>

/* 全域 log 詳細模式旗標 */
static int g_verbose = 0;

/* 取得目前時間字串，給 log 用，格式 HH:MM:SS.mmm */
static void sb__time_now(char *buf, size_t len) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);              /* 取得單調遞增的牆鐘時間 */
    struct tm tm_buf;
    localtime_r(&ts.tv_sec, &tm_buf);
    snprintf(buf, len, "%02d:%02d:%02d.%03ld",
             tm_buf.tm_hour, tm_buf.tm_min, tm_buf.tm_sec,
             ts.tv_nsec / 1000000);                  /* 奈秒轉毫秒 */
}

/* 對外：初始化 log 系統，目前只記下是否啟用 verbose */
void sb_log_init(int verbose) {
    g_verbose = verbose;
}

/* 內部共用：依照 level 將訊息寫到 stderr */
static void sb__vlog(const char *level, const char *fmt, va_list ap) {
    char ts[32];
    sb__time_now(ts, sizeof ts);
    /* pid 一併輸出，方便對照 sandbox / monitor / parent 各自的 log */
    fprintf(stderr, "[%s][%s][pid=%d] ", ts, level, (int)getpid());
    vfprintf(stderr, fmt, ap);
    fputc('\n', stderr);
    fflush(stderr);                                  /* 立即 flush，避免崩潰時丟訊息 */
}

/* INFO 等級僅在 verbose 開啟時顯示 */
void sb_log_info(const char *fmt, ...) {
    if (!g_verbose) return;
    va_list ap; va_start(ap, fmt);
    sb__vlog("INFO", fmt, ap);
    va_end(ap);
}

/* WARN 永遠顯示，但不終止程式 */
void sb_log_warn(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    sb__vlog("WARN", fmt, ap);
    va_end(ap);
}

/* ERR 永遠顯示，呼叫端通常會再回傳錯誤碼 */
void sb_log_err(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    sb__vlog("ERR ", fmt, ap);
    va_end(ap);
}

/* 致命錯誤：印出後 abort，本函式不會返回。
 * 注意只在「無法復原、繼續執行會危及安全」時才用 sb_die。
 * 一般錯誤要回傳 sb_error_t 讓上層決定。 */
void sb_die(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    sb__vlog("FATAL", fmt, ap);
    va_end(ap);
    /* errno 還可能有用，順便印出 strerror 方便除錯 */
    if (errno) fprintf(stderr, "  errno=%d (%s)\n", errno, strerror(errno));
    _exit(1);                                        /* 用 _exit 避免 atexit 副作用 */
}

/* 把整段 buffer 寫到指定路徑（覆蓋）
 * 主要用於 /proc/<pid>/uid_map、/sys/fs/cgroup/.../cpu.max 等 procfs/sysfs 介面，
 * 它們對「一次性寫入」的需求嚴格，必須一次 write 把完整內容塞進去。 */
int sb_write_file(const char *path, const char *buf, size_t len) {
    /* O_CLOEXEC 確保此 fd 不會洩漏到 exec 後的子行程，避免被沙盒內程式偷用 */
    int fd = open(path, O_WRONLY | O_CLOEXEC);
    if (fd < 0) {
        sb_log_err("open(%s) 失敗: %s", path, strerror(errno));
        return SB_ERR_GENERIC;
    }
    /* uid_map / setgroups 等介面需要一次 write 寫完，不可分段，故迴圈內若部分寫入也視為失敗 */
    ssize_t n = write(fd, buf, len);
    int saved = errno;
    close(fd);
    if (n != (ssize_t)len) {
        errno = saved;
        sb_log_err("write(%s) 失敗: 寫入 %zd/%zu, errno=%s", path, n, len, strerror(errno));
        return SB_ERR_GENERIC;
    }
    return SB_OK;
}

/* 讀檔輔助；最多讀 len-1 byte 並補上字串結束符 */
int sb_read_file(const char *path, char *buf, size_t len) {
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return SB_ERR_GENERIC;
    ssize_t n = read(fd, buf, len - 1);
    int saved = errno;
    close(fd);
    if (n < 0) { errno = saved; return SB_ERR_GENERIC; }
    buf[n] = '\0';
    return (int)n;
}
