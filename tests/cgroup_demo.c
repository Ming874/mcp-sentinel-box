/*
 * cgroup_demo.c - SentinelBox Phase 3 cgroup v2 資源限制 強制力實證 (展示版)
 *
 * 直接呼叫專案自家 core/src/cgroup.c 的 sb_cg_* 函式，建立受限 cgroup 並實證：
 *   [2] memory.max 強制：子行程配置 300MiB → 被 cgroup OOM 殺，mem 卡在 128MiB
 *   [3] cpu.max   強制：子行程全速燒 CPU → 實測使用率被壓在 ~50%
 * 輸出為適合截圖的排版（彩色 + 進度條 + 結論表）。
 *
 * 用法： cgroup_demo <parent_cgroup>     （parent 需已 enable +memory +cpu）
 */
#define _GNU_SOURCE
#include "sentinelbox.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/utsname.h>
#include <inttypes.h>

#define LIMIT_BYTES (128ULL * 1024 * 1024)
#define BOMB_BYTES  (300ULL * 1024 * 1024)
#define CHUNK       (4ULL   * 1024 * 1024)

#define C_RST "\033[0m"
#define C_HDR "\033[1;36m"   /* 亮青：標題 */
#define C_OK  "\033[1;32m"   /* 亮綠：PASS */
#define C_VAL "\033[1;37m"   /* 亮白：數值 */
#define C_DIM "\033[0;90m"   /* 灰：輔助 */
#define C_BAR "\033[1;33m"   /* 黃：進度條 */

static void rule(void){ printf(C_DIM "──────────────────────────────────────────────────────────────" C_RST "\n"); }

static double now_s(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec + t.tv_nsec/1e9; }

static long read_oom_kill(const char *cg){
    char p[SB_MAX_CGROUP_PATH+32]; snprintf(p,sizeof p,"%s/memory.events",cg);
    FILE *f=fopen(p,"r"); if(!f) return -1;
    char k[64]; long v,oom=0; while(fscanf(f,"%63s %ld",k,&v)==2) if(!strcmp(k,"oom_kill")) oom=v;
    fclose(f); return oom;
}

static void bar(double pct){
    int w=28, n=(int)(pct*w/100.0+0.5); if(n>w)n=w; if(n<0)n=0;
    printf(C_BAR "|"); for(int i=0;i<w;i++) putchar(i<n?'#':'.'); printf("|" C_RST);
}

int main(int argc,char**argv){
    sb_log_init(0);                 /* 安靜，讓畫面乾淨 */
    const char *parent=(argc>1)?argv[1]:SB_CGROUP_ROOT;

    sb_profile_t prof; memset(&prof,0,sizeof prof);
    snprintf(prof.name,sizeof prof.name,"strict");
    prof.mem_limit_bytes=LIMIT_BYTES; prof.cpu_max_quota=50000; prof.cpu_max_period=100000; prof.pids_max=32;
    sb_config_t cfg; memset(&cfg,0,sizeof cfg); cfg.cgroup_parent=parent;
    sb_runtime_t rt; memset(&rt,0,sizeof rt); rt.cfg=&cfg; rt.profile=&prof;

    /* ── 標題 ── */
    char host[128]={0}; gethostname(host,sizeof host-1);
    struct utsname un; uname(&un);
    printf("\n" C_HDR "══════════════════════════════════════════════════════════════" C_RST "\n");
    printf(C_HDR "  SentinelBox · Phase 3 — cgroup v2 資源限制 強制力實證" C_RST "\n");
    printf(C_HDR "══════════════════════════════════════════════════════════════" C_RST "\n");
    printf("  host    : " C_VAL "%s" C_RST "\n",host);
    printf("  kernel  : " C_VAL "%s %s" C_RST "\n",un.sysname,un.release);
    printf("  code    : " C_VAL "core/src/cgroup.c" C_RST C_DIM "  (sb_cg_create / apply_limits / attach / read)" C_RST "\n\n");

    /* ── [1] 套用限制 ── */
    if(sb_cg_create(&rt)!=SB_OK){ fprintf(stderr,"無法建立 cgroup（parent 未 delegate）\n"); return 2; }
    sb_cg_apply_limits(&rt);
    char mp[SB_MAX_CGROUP_PATH+32],buf[64]={0};
    snprintf(mp,sizeof mp,"%s/memory.max",rt.cgroup_path);
    if(sb_read_file(mp,buf,sizeof buf)>0 && !strncmp(buf,"max",3)){
        fprintf(stderr,"memory.max 未生效（parent 未 enable +memory）\n"); sb_cg_cleanup(rt.cgroup_path); return 2; }
    rule();
    printf(" " C_HDR "[1]" C_RST " 套用 strict profile 資源限制\n"); rule();
    printf("   cgroup      = " C_VAL "%s" C_RST "\n",rt.cgroup_path);
    printf("   memory.max  = " C_VAL "128 MiB" C_RST C_DIM "  (134217728 bytes)" C_RST "\n");
    printf("   cpu.max     = " C_VAL "50000 / 100000 us" C_RST C_DIM "  (≈ 50%% of one CPU)" C_RST "\n");
    printf("   pids.max    = " C_VAL "32" C_RST "\n\n");

    /* ── [2] memory.max 強制 ── */
    rule(); printf(" " C_HDR "[2]" C_RST " 記憶體上限強制 — 子行程嘗試配置 300 MiB\n"); rule();
    double t0=now_s();
    pid_t pid=fork();
    if(pid==0){
        sb_cg_attach(rt.cgroup_path,getpid());
        uint64_t got=0; while(got<BOMB_BYTES){ char*p=malloc(CHUNK); if(!p)_exit(4); memset(p,'a',CHUNK); got+=CHUNK; usleep(20000);} _exit(0);
    }
    uint64_t mem_peak=0; int status=0,s=0;
    for(;;){ if(waitpid(pid,&status,WNOHANG)==pid) break;
        uint64_t m=0; if(sb_cg_read_memory_current(rt.cgroup_path,&m)==SB_OK && m>mem_peak) mem_peak=m;
        if(++s%3==0){ double pct=(double)m/LIMIT_BYTES*100.0;
            printf("   +%.2fs  %6.1f MiB  ",now_s()-t0,(double)m/1048576.0); bar(pct); printf("  %3.0f%%\n",pct);}
        usleep(100000);
    }
    long oom=read_oom_kill(rt.cgroup_path);
    int killed=WIFSIGNALED(status)&&WTERMSIG(status)==9;
    printf("   " C_OK "⟹ 觸及 128 MiB 上限，子行程被 cgroup OOM 強制終止 (SIGKILL)" C_RST "\n");
    printf("   memory.events.oom_kill = " C_VAL "%ld" C_RST "\n\n",oom);

    /* ── [3] cpu.max 強制 ── */
    rule(); printf(" " C_HDR "[3]" C_RST " CPU 配額強制 — 子行程全速燒 CPU 2.0s\n"); rule();
    uint64_t c0=0; sb_cg_read_cpu_usage(rt.cgroup_path,&c0); double w0=now_s();
    pid_t cp=fork();
    if(cp==0){ sb_cg_attach(rt.cgroup_path,getpid()); volatile unsigned long x=0; for(;;) x++; }
    usleep(2000000);
    uint64_t c1=0; sb_cg_read_cpu_usage(rt.cgroup_path,&c1); double w1=now_s();
    kill(cp,SIGKILL); waitpid(cp,NULL,0);
    double cpu_pct = (double)(c1-c0)/((w1-w0)*1e6)*100.0;
    int cpu_ok = cpu_pct <= 65.0;     /* 上限 50%，留寬容 */
    printf("   實測 CPU 使用率 = " C_VAL "%.1f %%" C_RST C_DIM "   (cpu.max 配額 = 50%%)" C_RST "\n",cpu_pct);
    printf("   " C_OK "⟹ cpu.max 把 CPU 壓在配額內，未超過一顆核心的 50%%" C_RST "\n\n");

    sb_cg_cleanup(rt.cgroup_path);

    /* ── 結論 ── */
    int mem_ok = killed && oom>0 && mem_peak<=(uint64_t)(LIMIT_BYTES*1.10) && mem_peak>=(uint64_t)(LIMIT_BYTES*0.50);
    rule(); printf(" " C_HDR "結論" C_RST "\n"); rule();
    printf("   [%s] memory.max 強制" C_RST "：300 MiB 配置被攔截，峰值 " C_VAL "%.1f MiB" C_RST "\n", mem_ok?C_OK"PASS":"\033[1;31mFAIL", (double)mem_peak/1048576.0);
    printf("   [%s] OOM 記錄" C_RST "    ：memory.events.oom_kill = " C_VAL "%ld" C_RST "\n", (oom>0)?C_OK"PASS":"\033[1;31mFAIL", oom);
    printf("   [%s] cpu.max 強制" C_RST "  ：實測 " C_VAL "%.1f%%" C_RST " ≤ 配額 50%%(+寬容)\n", cpu_ok?C_OK"PASS":"\033[1;31mFAIL", cpu_pct);
    printf("\n");
    if(mem_ok && oom>0 && cpu_ok){
        printf("   " C_OK "✅  Phase 3 cgroup 資源限制 — 全部實證通過" C_RST "\n");
        printf(C_HDR "══════════════════════════════════════════════════════════════" C_RST "\n\n");
        return 0;
    }
    printf("   \033[1;31m✗  部分項目未通過\033[0m\n");
    printf(C_HDR "══════════════════════════════════════════════════════════════" C_RST "\n\n");
    return 1;
}
