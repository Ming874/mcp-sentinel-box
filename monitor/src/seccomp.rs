//! seccomp.rs - SECCOMP_RET_USER_NOTIF 的 ioctl 介面與資料結構
//!
//! 此模組封裝 Linux 5.0+ 的 user notification API：
//!   - `SECCOMP_IOCTL_NOTIF_RECV`：從 notify_fd 取一筆等待中的 syscall 通知
//!   - `SECCOMP_IOCTL_NOTIF_SEND`：回應該通知（ALLOW / 用 errno 拒絕 / continue）
//!   - `SECCOMP_IOCTL_NOTIF_ID_VALID`：檢查 notification id 是否仍有效（target 是否還活著）
//!
//! 為什麼直接做 ioctl 而不用第三方 crate：
//!   - 第三方 seccomp crate 多半著重 filter 構築，user notif 處理較少；
//!   - 直接打 ioctl 程式碼極短，可讀性高，依賴更少，方便老師審閱。

use anyhow::{anyhow, Result};
use libc::{c_int, c_void};
use std::os::unix::io::RawFd;

/// `struct seccomp_data` 對應 linux/seccomp.h
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct SeccompData {
    pub nr: i32,                      /* syscall 編號（負值表示 raw_syscall_intercept） */
    pub arch: u32,                    /* AUDIT_ARCH_X86_64 等 */
    pub instruction_pointer: u64,     /* 觸發 syscall 的 user-space IP */
    pub args: [u64; 6],               /* syscall 六個參數（架構相關） */
}

/// `struct seccomp_notif`
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct SeccompNotif {
    pub id: u64,                      /* notification 唯一識別碼 */
    pub pid: u32,                     /* 觸發 syscall 的 target pid（global PID 命名空間） */
    pub flags: u32,                   /* 目前 reserved，總是 0 */
    pub data: SeccompData,
}

/// `struct seccomp_notif_resp`
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct SeccompNotifResp {
    pub id: u64,
    pub val: i64,                     /* 返回值（若用 SECCOMP_USER_NOTIF_FLAG_CONTINUE 則忽略） */
    pub error: i32,                   /* errno（負值；0 表成功） */
    pub flags: u32,                   /* 0 或 SECCOMP_USER_NOTIF_FLAG_CONTINUE */
}

/// `SECCOMP_USER_NOTIF_FLAG_CONTINUE`：放行此 syscall，讓 kernel 真正執行
pub const SECCOMP_USER_NOTIF_FLAG_CONTINUE: u32 = 1 << 0;

/* ---------- ioctl 編號計算 ----------
 * Linux _IOC 巨集：
 *   _IOC(dir, type, nr, size) = (dir << 30) | (type << 8) | nr | (size << 16)
 * dir bits: NONE=0, WRITE=1, READ=2, READ|WRITE=3
 *
 * SECCOMP_IOC_MAGIC = '!' = 0x21
 *
 * 我們需要：
 *   SECCOMP_IOCTL_NOTIF_RECV = _IOWR(0, seccomp_notif)
 *   SECCOMP_IOCTL_NOTIF_SEND = _IOWR(1, seccomp_notif_resp)
 *   SECCOMP_IOCTL_NOTIF_ID_VALID = _IOW(2, u64)
 */
const fn ioc(dir: u32, ty: u32, nr: u32, sz: u32) -> u32 {
    (dir << 30) | (ty << 8) | nr | (sz << 16)
}
const IOC_READ_WRITE: u32 = 3;
const IOC_WRITE: u32 = 1;
const SECCOMP_IOC_MAGIC: u32 = b'!' as u32;

pub const SECCOMP_IOCTL_NOTIF_RECV: u64 = ioc(
    IOC_READ_WRITE,
    SECCOMP_IOC_MAGIC,
    0,
    std::mem::size_of::<SeccompNotif>() as u32,
) as u64;

pub const SECCOMP_IOCTL_NOTIF_SEND: u64 = ioc(
    IOC_READ_WRITE,
    SECCOMP_IOC_MAGIC,
    1,
    std::mem::size_of::<SeccompNotifResp>() as u32,
) as u64;

pub const SECCOMP_IOCTL_NOTIF_ID_VALID: u64 =
    ioc(IOC_WRITE, SECCOMP_IOC_MAGIC, 2, std::mem::size_of::<u64>() as u32) as u64;

/// 對 notify_fd 發 `SECCOMP_IOCTL_NOTIF_RECV`，blocking 直到有 syscall 觸發 NOTIFY。
/// EINTR 會由呼叫端決定要重試或退出（通常 signal 處理時）。
pub fn recv(fd: RawFd) -> Result<SeccompNotif> {
    let mut n: SeccompNotif = SeccompNotif::default();
    // ioctl 對 RECV 來說是把 kernel 的資料寫到 user buffer，
    // 故傳遞 &mut 指標即可。回傳值 0 表成功。
    let rc = unsafe {
        libc::ioctl(
            fd,
            SECCOMP_IOCTL_NOTIF_RECV as _,
            &mut n as *mut _ as *mut c_void,
        )
    };
    if rc < 0 {
        let e = std::io::Error::last_os_error();
        return Err(anyhow!("SECCOMP_IOCTL_NOTIF_RECV 失敗: {e}"));
    }
    Ok(n)
}

/// 回應 notify_fd：對 kernel 說明此 syscall 該怎麼處理。
/// 若 target 已死亡 (target 在收到回應前被 kill)，ioctl 會回 ENOENT，呼叫端忽略即可。
pub fn send(fd: RawFd, resp: &SeccompNotifResp) -> Result<()> {
    let rc = unsafe {
        libc::ioctl(
            fd,
            SECCOMP_IOCTL_NOTIF_SEND as _,
            resp as *const _ as *const c_void,
        )
    };
    if rc < 0 {
        let e = std::io::Error::last_os_error();
        // ENOENT 表 target 已不存在；我們不該因此 crash
        if e.raw_os_error() == Some(libc::ENOENT) {
            tracing::debug!("NOTIF_SEND ENOENT (target 已不存在)");
            return Ok(());
        }
        return Err(anyhow!("SECCOMP_IOCTL_NOTIF_SEND 失敗: {e}"));
    }
    Ok(())
}

/// 確認 notification id 仍有效（target 還活著，且尚未送出 response）。
/// 在我們讀完 args 後、做決策之前可呼叫，避免 TOCTOU 問題。
pub fn id_valid(fd: RawFd, id: u64) -> bool {
    let rc = unsafe {
        libc::ioctl(
            fd,
            SECCOMP_IOCTL_NOTIF_ID_VALID as _,
            &id as *const _ as *const c_void,
        )
    };
    rc == 0
}

/// 工具：把 syscall 編號轉成可讀名稱（給 log / audit 用）。
/// 不維護完整對照表；只列我們真的關心的 syscall，其餘回傳 "syscall_<nr>"。
pub fn syscall_name(nr: i32) -> &'static str {
    match nr {
        // x86_64 編號
        41 => "socket",
        42 => "connect",
        43 => "accept",
        44 => "sendto",
        45 => "recvfrom",
        46 => "sendmsg",
        47 => "recvmsg",
        48 => "shutdown",
        49 => "bind",
        50 => "listen",
        51 => "getsockname",
        52 => "getpeername",
        53 => "socketpair",
        101 => "ptrace",
        165 => "mount",
        166 => "umount2",
        272 => "unshare",
        308 => "setns",
        321 => "bpf",
        298 => "perf_event_open",
        _ => "syscall_unknown",
    }
}
