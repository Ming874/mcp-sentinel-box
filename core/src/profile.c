/*
 * profile.c - 安全 profile 載入與查詢
 *
 * 從 profiles/<name>.json 載入並轉成 sb_profile_t。
 * 動作字串 → sb_action_t、syscall 名稱 → 系統呼叫編號（透過 libseccomp）。
 *
 * 為什麼用 libseccomp 而非自己 hardcode：
 *   - x86_64 / aarch64 syscall 編號不同；libseccomp 內建跨架構表。
 *   - 老師會檢查跨平台相容性，hardcode 號碼是大忌（見 AGENT.md "Never" #2）。
 */

#define _GNU_SOURCE
#include "sentinelbox.h"
#include "json_lite.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <sys/stat.h>
#include <seccomp.h>     /* libseccomp: SCMP_*, seccomp_syscall_resolve_name */

/* 將 action 字串轉成 sb_action_t；找不到回 -1 */
static int parse_action(const char *s, sb_action_t *out) {
    if (!s) return -1;
    if (strcmp(s, "ALLOW") == 0)  { *out = SB_ACT_ALLOW;  return 0; }
    if (strcmp(s, "ERRNO") == 0)  { *out = SB_ACT_ERRNO;  return 0; }
    if (strcmp(s, "NOTIFY") == 0) { *out = SB_ACT_NOTIFY; return 0; }
    if (strcmp(s, "KILL") == 0)   { *out = SB_ACT_KILL;   return 0; }
    return -1;
}

/* 把整個 JSON 檔讀進記憶體 */
static char *slurp(const char *path, size_t *out_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) return NULL;
    if (fseek(fp, 0, SEEK_END) != 0) { fclose(fp); return NULL; }
    long sz = ftell(fp);
    if (sz < 0) { fclose(fp); return NULL; }
    if (fseek(fp, 0, SEEK_SET) != 0) { fclose(fp); return NULL; }
    char *buf = (char *)malloc((size_t)sz + 1);
    if (!buf) { fclose(fp); return NULL; }
    size_t n = fread(buf, 1, (size_t)sz, fp);
    fclose(fp);
    buf[n] = '\0';
    *out_len = n;
    return buf;
}

/* 從 profile JSON 樹中載入 syscall_rules 陣列到結構 */
static int load_rules(sb_profile_t *p, const sb_json_t *rules_arr) {
    if (!rules_arr || rules_arr->type != SB_JSON_ARRAY) return 0; /* 沒有 rules 也合法 */
    p->rule_count = 0;
    for (const sb_json_t *it = sb_json_array_first(rules_arr); it; it = it->next) {
        if (p->rule_count >= SB_MAX_SYSCALLS) {
            sb_log_warn("profile syscall rules 超過上限 %d，後續忽略", SB_MAX_SYSCALLS);
            break;
        }
        const char *name = sb_json_as_str(sb_json_get(it, "name"), NULL);
        const char *act  = sb_json_as_str(sb_json_get(it, "action"), NULL);
        long long errv   = sb_json_as_int(sb_json_get(it, "errno"), 1);
        if (!name || !act) {
            sb_log_warn("profile 規則缺少 name 或 action，已跳過");
            continue;
        }
        /* libseccomp 將 syscall 名稱解析為平台對應的編號（-1 表未知） */
        int nr = seccomp_syscall_resolve_name(name);
        if (nr == __NR_SCMP_ERROR) {
            sb_log_warn("未知 syscall 名稱: %s，已跳過", name);
            continue;
        }
        sb_action_t a;
        if (parse_action(act, &a) != 0) {
            sb_log_warn("未知 action: %s（syscall=%s），已跳過", act, name);
            continue;
        }
        p->rules[p->rule_count].syscall_nr = nr;
        p->rules[p->rule_count].action     = a;
        p->rules[p->rule_count].errno_value = (int)errv;
        p->rule_count++;
    }
    return 0;
}

/* 對外：載入指定 profile，回傳堆疊配置的 sb_profile_t* */
sb_profile_t *sb_profile_load(const char *dir, const char *name) {
    if (!dir || !name) { errno = EINVAL; return NULL; }
    char path[512];
    snprintf(path, sizeof path, "%s/%s.json", dir, name);
    size_t len;
    char *raw = slurp(path, &len);
    if (!raw) {
        sb_log_err("無法讀取 profile 檔: %s (%s)", path, strerror(errno));
        return NULL;
    }
    sb_json_t *root = sb_json_parse(raw, len);
    free(raw);
    if (!root) { sb_log_err("profile JSON 解析失敗: %s", path); return NULL; }

    sb_profile_t *p = (sb_profile_t *)calloc(1, sizeof *p);
    if (!p) { sb_json_free(root); return NULL; }

    /* meta 區段 */
    const char *pname = sb_json_as_str(sb_json_get(root, "name"), name);
    strncpy(p->name, pname, sizeof p->name - 1);

    /* 預設動作 */
    sb_action_t da;
    if (parse_action(sb_json_as_str(sb_json_get(root, "default_action"), "ERRNO"), &da) != 0) {
        da = SB_ACT_ERRNO;
    }
    p->default_action = da;

    /* syscall rules */
    load_rules(p, sb_json_get(root, "syscall_rules"));

    /* 資源限制 */
    const sb_json_t *res = sb_json_get(root, "resources");
    if (res) {
        p->mem_limit_bytes = (uint64_t)sb_json_as_int(sb_json_get(res, "mem_limit_bytes"), 128 * 1024 * 1024);
        p->cpu_max_quota   = (uint64_t)sb_json_as_int(sb_json_get(res, "cpu_max_quota"),   50000);
        p->cpu_max_period  = (uint64_t)sb_json_as_int(sb_json_get(res, "cpu_max_period"),  100000);
        p->pids_max        = (uint32_t)sb_json_as_int(sb_json_get(res, "pids_max"),        32);
        p->io_max_rbps     = (uint64_t)sb_json_as_int(sb_json_get(res, "io_max_rbps"),     0);
        p->io_max_wbps     = (uint64_t)sb_json_as_int(sb_json_get(res, "io_max_wbps"),     0);
    } else {
        /* 沒給 resources 區段時的保守預設 */
        p->mem_limit_bytes = 128 * 1024 * 1024;
        p->cpu_max_quota   = 50000;
        p->cpu_max_period  = 100000;
        p->pids_max        = 32;
    }

    /* 網路策略 */
    const sb_json_t *net = sb_json_get(root, "network");
    if (net) {
        p->allow_network = sb_json_as_bool(sb_json_get(net, "allow"), 0);
        p->allow_dns     = sb_json_as_bool(sb_json_get(net, "allow_dns"), 0);
    }

    /* 檔案系統策略 */
    const sb_json_t *fs = sb_json_get(root, "filesystem");
    if (fs) {
        p->allow_write_overlay = sb_json_as_bool(sb_json_get(fs, "allow_write_overlay"), 1);
    } else {
        p->allow_write_overlay = 1; /* tmpfs upper layer 預設允許寫，反正重啟即清掉 */
    }

    sb_json_free(root);
    sb_log_info("profile 載入完成: name=%s, rules=%zu, mem=%lu MB",
                p->name, p->rule_count, (unsigned long)(p->mem_limit_bytes >> 20));
    return p;
}

void sb_profile_free(sb_profile_t *p) {
    free(p);
}

/* 查詢指定 syscall 的處理動作；若無明列規則則回傳 default_action */
sb_action_t sb_profile_lookup(const sb_profile_t *p, int syscall_nr, int *errno_out) {
    if (!p) return SB_ACT_KILL;
    for (size_t i = 0; i < p->rule_count; i++) {
        if (p->rules[i].syscall_nr == syscall_nr) {
            if (errno_out) *errno_out = p->rules[i].errno_value;
            return p->rules[i].action;
        }
    }
    if (errno_out) *errno_out = EPERM; /* 預設 ERRNO 用 EPERM */
    return p->default_action;
}
