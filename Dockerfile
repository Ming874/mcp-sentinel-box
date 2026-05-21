# Dockerfile - SentinelBox AI Agent Sandbox
#
# 三階段建置：
#   c-builder    → 編譯 C 隔離引擎（libseccomp / libcap）
#   rust-builder → 編譯 Rust monitor + telemetry + audit DB
#   runtime      → 最小 Ubuntu 22.04，帶 binary + busybox rootfs + 開發工具
#
# 執行需求：
#   docker compose run --rm sandbox -- /bin/sh -c "echo hello"
#   （需要 --privileged --cgroupns=private，見 docker-compose.yml）

ARG TZ=Asia/Taipei
ARG UBUNTU_VERSION=24.04

# ─────────────────────────────────────────────
# Stage 1：C 隔離引擎
# ─────────────────────────────────────────────
FROM ubuntu:${UBUNTU_VERSION} AS c-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libseccomp-dev \
    libcap-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src/core
COPY core/ .
RUN make all

# ─────────────────────────────────────────────
# Stage 2：Rust monitor + telemetry + audit DB
# ─────────────────────────────────────────────
FROM rust:1.85-slim-bookworm AS rust-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src/monitor
COPY monitor/ .
RUN cargo build --release

# ─────────────────────────────────────────────
# Stage 3：Runtime image
# ─────────────────────────────────────────────
FROM ubuntu:${UBUNTU_VERSION} AS runtime

ARG TZ=Asia/Taipei
ENV TZ="$TZ"

# Runtime lib + 開發除錯工具（jq / sqlite3 / vim 方便 audit log 查看）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libseccomp2 \
    libcap2 \
    busybox-static \
    tzdata \
    jq \
    sqlite3 \
    vim \
    nano \
    procps \
    iproute2 \
    && rm -rf /var/lib/apt/lists/*

# 可執行檔
COPY --from=c-builder    /src/core/build/sentinelbox                      /usr/local/bin/sentinelbox
COPY --from=rust-builder /src/monitor/target/release/sentinelbox-monitor  /usr/local/bin/sentinelbox-monitor

# Profile JSON
COPY profiles/ /etc/sentinelbox/profiles/

# 錯誤碼 → 語義 mapping 邏輯表（提案書 §4，可由 SENTINELBOX_MAPPINGS 指向自訂檔）
COPY mappings/ /etc/sentinelbox/mappings/

# 建立最小 busybox rootfs（沙盒內的 lowerdir）
# 注意：明列目錄而非用 {a,b} brace expansion，因 Docker RUN 預設 /bin/sh=dash 不支援
RUN mkdir -p \
        /srv/rootfs/bin /srv/rootfs/sbin \
        /srv/rootfs/usr/bin /srv/rootfs/usr/sbin \
        /srv/rootfs/etc /srv/rootfs/proc /srv/rootfs/sys \
        /srv/rootfs/dev /srv/rootfs/tmp /srv/rootfs/var/log \
    && cp /bin/busybox /srv/rootfs/bin/busybox \
    && cd /srv/rootfs/bin \
    && for applet in $(./busybox --list); do [ "$applet" = busybox ] || ln -sf busybox "$applet"; done \
    && chmod 1777 /srv/rootfs/tmp
# 注意：用相對符號連結 (sh->busybox)，不可用 `busybox --install -s`。
# 後者建絕對連結指向 /srv/rootfs/bin/busybox，sandbox pivot_root 後該路徑不存在 → execvp ENOENT。

# 建立非 root 執行 user（sentinelbox 本體透過 User Namespace 在內部 map root）
RUN groupadd -r sentinel && useradd -r -g sentinel -d /var/lib/sentinelbox -s /bin/bash sentinel

# audit DB 目錄（掛 volume 才能跨 container 保留歷史）
RUN mkdir -p /var/lib/sentinelbox && chown sentinel:sentinel /var/lib/sentinelbox

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 預設環境變數（可被 docker run -e 覆寫）
# SENTINELBOX_PROFILE_DIR 必須設定：monitor 子進程靠這個 env 找 profile JSON，
# 否則會 fallback 到相對路徑 ./profiles 而找不到。
ENV SENTINELBOX_PROFILE=strict \
    SENTINELBOX_PROFILE_DIR=/etc/sentinelbox/profiles \
    SENTINELBOX_DB=/var/lib/sentinelbox/audit.db \
    SENTINELBOX_MAPPINGS=/etc/sentinelbox/mappings/syscall_feedback.json \
    SENTINELBOX_LOG=info

VOLUME /var/lib/sentinelbox

USER sentinel

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["--help"]
