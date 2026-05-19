//! ipc.rs - 從 C 主程式繼承的 socket 上接收 seccomp notify fd
//!
//! 流程對應 C 端 core/src/ipc.c：sandbox child 用 SCM_RIGHTS 將 notify_fd 傳給 monitor。
//! Rust 端在 fd 3（由 SB_ENV_MONITOR_FD 指定）listen recvmsg，
//! 從 control message 取出 fd，並讀取附帶 ASCII 訊息（"NOTIFY_FD"）作為握手確認。

use anyhow::{anyhow, Context, Result};
use nix::sys::socket::{recvmsg, ControlMessageOwned, MsgFlags};
use std::io::IoSliceMut;
use std::os::unix::io::RawFd;

/// 對外 API：從給定 socket fd 收取一個 fd + 短訊息。
/// 對應 C 端 `sb_ipc_send_fd`。
pub fn recv_fd(sock_fd: RawFd) -> Result<(RawFd, String)> {
    // 用於收附加文字訊息的 buffer
    let mut buf = [0u8; 256];
    let mut iov = [IoSliceMut::new(&mut buf)];

    // control message buffer：留充足空間給 CMSG_SPACE(sizeof(int)) 加額外緩衝
    let mut cmsg_buf = nix::cmsg_space!(RawFd);

    // nix 0.27 recvmsg 仍以 RawFd 為第一參數；直接傳入即可
    let msg = recvmsg::<()>(sock_fd, &mut iov, Some(&mut cmsg_buf), MsgFlags::empty())
        .with_context(|| format!("recvmsg(fd={sock_fd}) 失敗"))?;

    // 從 cmsg 中找 SCM_RIGHTS
    let mut got_fd: Option<RawFd> = None;
    for cmsg in msg.cmsgs() {
        if let ControlMessageOwned::ScmRights(fds) = cmsg {
            if let Some(&fd) = fds.first() {
                got_fd = Some(fd);
            }
        }
    }
    let fd = got_fd.ok_or_else(|| anyhow!("recvmsg 缺少 SCM_RIGHTS control message"))?;

    // 取出附帶的握手字串。msg.bytes 為 recvmsg 寫入 iov 的總長度。
    let n = msg.bytes;
    let txt = if n > 0 {
        String::from_utf8_lossy(&buf[..n]).trim_end_matches('\0').to_string()
    } else {
        String::new()
    };

    Ok((fd, txt))
}
