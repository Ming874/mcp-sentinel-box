/*
 * sentinelbox.h - SentinelBox 核心隔離引擎共用標頭檔
 *
 * 本檔宣告所有跨模組共用的資料結構、常數與函式原型。
 * 任何 core/src 目錄下的 .c 都應 #include "sentinelbox.h" 以取得一致的型別定義。
 *
 * 設計原則：
 *   1. 結構體以 sb_ 前綴避免污染全域命名空間。
 *   2. 錯誤碼採 POSIX 慣例 (回傳 0 表成功，-1 表失敗，errno 帶錯誤原因)。
 *   3. 不在標頭暴露平台相依細節，平台 #include 集中於各 .c。
 */

#ifndef SENTINELBOX_H
#define SENTINELBOX_H

#include <stddef.h>      /* size_t */
#include <stdint.h>      /* uint32_t/uint64_t */
#include <sys/types.h>   /* pid_t / uid_t */

/* ---------- 編譯常數 ---------- */

/* 沙盒內 init 行程的 PID（PID namespace 內第一個行程一律是 1） */
#define SB_INIT_PID                 1

/* 預設 stack 大小：8 MiB，給 clone() 用的子行程堆疊 */
#define SB_CHILD_STACK_SIZE         (8 * 1024 * 1024)

/* 一條 syscall whitelist 最多容納的 syscall 數量 */
#define SB_MAX_SYSCALLS             256

/* profile 名稱最大長度 */
#define SB_MAX_PROFILE_NAME         64

/* cgroup 路徑最大長度 */
#define SB_MAX_CGROUP_PATH          256

/* 一次性執行的目標程式參數上限 */
#define SB_MAX_ARGS                 32

/* SCM_RIGHTS 傳 fd 用的 socket 環境變數名稱
 * monitor 進程啟動時會從這個環境變數取得 socket fd 號碼。 */
#define SB_ENV_MONITOR_FD           "SENTINELBOX_MONITOR_FD"

/* cgroup v2 根目錄，標準位置為 /sys/fs/cgroup */
#define SB_CGROUP_ROOT              "/sys/fs/cgroup"

/* ---------- 錯誤碼 ---------- */
/* 自訂錯誤碼 (回傳值為負；用以區分不同模組失敗原因) */
typedef enum {
    SB_OK              = 0,     /* 成功 */
    SB_ERR_GENERIC     = -1,    /* 一般失敗 */
    SB_ERR_INVAL       = -2,    /* 參數不合法 */
    SB_ERR_PROFILE     = -3,    /* profile 載入或解析失敗 */
    SB_ERR_NS          = -4,    /* namespace 建立失敗 */
    SB_ERR_MOUNT       = -5,    /* 檔案系統掛載失敗 */
    SB_ERR_CGROUP      = -6,    /* cgroup 設定失敗 */
    SB_ERR_SECCOMP     = -7,    /* seccomp filter 安裝失敗 */
    SB_ERR_IPC         = -8,    /* IPC 傳遞 fd 失敗 */
    SB_ERR_CAP         = -9,    /* capability 操作失敗 */
    SB_ERR_NOMEM       = -10,   /* 記憶體配置失敗 */
} sb_error_t;

/* ---------- Profile 結構 ---------- */

/* syscall 動作：通過、阻擋、通報給 monitor */
typedef enum {
    SB_ACT_ALLOW       = 0,     /* 允許執行 */
    SB_ACT_ERRNO       = 1,     /* 直接回傳 errno（不通報） */
    SB_ACT_NOTIFY      = 2,     /* 通報 monitor，由 monitor 決定 */
    SB_ACT_KILL        = 3,     /* 直接 SIGSYS 殺掉行程 */
} sb_action_t;

/* 單一 syscall 規則 */
typedef struct {
    int                 syscall_nr;     /* syscall 編號 (用 SCMP_SYS) */
    sb_action_t         action;         /* 該 syscall 的處理動作 */
    int                 errno_value;    /* 若 action 為 ERRNO，回傳的 errno */
} sb_syscall_rule_t;

/* Profile 結構 - 對應 profiles 目錄下的 .json */
typedef struct {
    char                name[SB_MAX_PROFILE_NAME];  /* profile 識別名 */

    /* 系統呼叫策略 */
    sb_action_t         default_action;             /* 未明列 syscall 的預設動作 */
    sb_syscall_rule_t   rules[SB_MAX_SYSCALLS];     /* 明列的 syscall 規則 */
    size_t              rule_count;                 /* 規則數量 */

    /* 資源限制 (對應 cgroup v2 controller) */
    uint64_t            mem_limit_bytes;            /* memory.max 數值 */
    uint64_t            cpu_max_quota;              /* cpu.max quota (微秒) */
    uint64_t            cpu_max_period;             /* cpu.max period (微秒) */
    uint32_t            pids_max;                   /* pids.max */
    uint64_t            io_max_rbps;                /* 讀取頻寬上限 byte/s, 0=無限 */
    uint64_t            io_max_wbps;                /* 寫入頻寬上限 byte/s, 0=無限 */

    /* 網路策略 */
    int                 allow_network;              /* 0=完全切斷, 1=有限制允許 */
    int                 allow_dns;                  /* 是否允許 DNS 查詢 */

    /* 檔案系統策略 */
    int                 allow_write_overlay;        /* 是否允許寫入 overlay 上層 */
} sb_profile_t;

/* ---------- CLI 設定 ---------- */
typedef struct {
    const char         *profile_name;       /* --profile=strict */
    const char         *profile_dir;        /* profile JSON 所在目錄 */
    const char         *rootfs_dir;         /* --rootfs=/path/to/busybox */
    const char         *target;             /* --code='print(1)' 或 --file=foo.py */
    const char         *target_file;        /* --file 對應路徑 */
    const char         *monitor_bin;        /* sentinelbox-monitor 路徑 */
    const char         *cgroup_parent;      /* 父 cgroup */
    char * const       *argv;               /* 傳給沙盒內目標的 argv */
    int                 argc;
    int                 verbose;            /* -v 詳細輸出 */
    int                 no_monitor;         /* --no-monitor 不啟動 monitor */
} sb_config_t;

/* ---------- 執行階段環境 ---------- */
typedef struct {
    sb_config_t        *cfg;                /* CLI 設定（不擁有所有權） */
    sb_profile_t       *profile;            /* 已載入的 profile（擁有所有權） */
    pid_t               sandbox_pid;        /* clone() 出來的沙盒子行程 PID */
    pid_t               monitor_pid;        /* fork+exec 的 monitor 行程 PID */
    int                 ipc_sock_parent;    /* socketpair 父端 (傳給 monitor) */
    int                 ipc_sock_child;     /* socketpair 子端 (給 sandbox child) */
    int                 sync_pipe[2];       /* 父子同步 (uid_map 寫完後通知) */
    int                 cgroup_active;      /* cgroup 是否成功建立並可用 */
    char                cgroup_path[SB_MAX_CGROUP_PATH]; /* 本次執行專屬 cgroup */
} sb_runtime_t;

/* ---------- 公開函式：util.c ---------- */
void sb_log_init(int verbose);
void sb_log_info(const char *fmt, ...);
void sb_log_warn(const char *fmt, ...);
void sb_log_err(const char *fmt, ...);
void sb_die(const char *fmt, ...) __attribute__((noreturn));
int  sb_write_file(const char *path, const char *buf, size_t len);
int  sb_read_file(const char *path, char *buf, size_t len);

/* ---------- 公開函式：profile.c ---------- */
sb_profile_t *sb_profile_load(const char *dir, const char *name);
void          sb_profile_free(sb_profile_t *p);
sb_action_t   sb_profile_lookup(const sb_profile_t *p, int syscall_nr, int *errno_out);

/* ---------- 公開函式：namespace.c ---------- */
int  sb_ns_write_uid_map(pid_t pid, uid_t host_uid);
int  sb_ns_write_gid_map(pid_t pid, gid_t host_gid);
int  sb_ns_disable_setgroups(pid_t pid);
int  sb_ns_set_hostname(const char *name);

/* ---------- 公開函式：overlayfs.c ---------- */
int  sb_ofs_setup(const char *rootfs);
int  sb_ofs_pivot_root(void);
int  sb_ofs_mount_proc(void);

/* ---------- 公開函式：cgroup.c ---------- */
int  sb_cg_create(sb_runtime_t *rt);
int  sb_cg_apply_limits(sb_runtime_t *rt);
int  sb_cg_attach(const char *cgroup_path, pid_t pid);
int  sb_cg_cleanup(const char *cgroup_path);
int  sb_cg_read_memory_current(const char *cgroup_path, uint64_t *out);
int  sb_cg_read_cpu_usage(const char *cgroup_path, uint64_t *usec_out);

/* ---------- 公開函式：capability.c ---------- */
int  sb_cap_drop_dangerous(void);
int  sb_cap_set_no_new_privs(void);

/* ---------- 公開函式：seccomp.c ---------- */
int  sb_seccomp_install(const sb_profile_t *p, int *listener_fd_out);

/* ---------- 公開函式：ipc.c ---------- */
int  sb_ipc_send_fd(int sock, int fd, const char *msg);
int  sb_ipc_recv_fd(int sock, int *fd_out, char *msg_buf, size_t msg_len);
int  sb_ipc_make_pair(int sv[2]);

/* ---------- 公開函式：sandbox.c ---------- */
int  sb_sandbox_run(sb_runtime_t *rt);

#endif /* SENTINELBOX_H */
