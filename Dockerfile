# Dockerfile - SentinelBox AI Agent Sandbox
#
# 三階段建置：
#   c-builder   → 編譯 C 隔離引擎（libseccomp / libcap 靜態需求）
#   rust-builder → 編譯 Rust monitor + telemetry + audit DB
#   runtime     → 最小 Ubuntu 22.04，只帶 binary + busybox rootfs
#
# 執行需求：
#   docker run --privileged --cgroupns=private \
#     -v sentinelbox-data:/var/lib/sentinelbox \
#     sentinelbox:latest -- /bin/sh -c "echo hello"

# ─────────────────────────────────────────────
# Stage 1：C 隔離引擎
# ─────────────────────────────────────────────
FROM ubuntu:22.04 AS c-builder

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
FROM rust:1.78-slim-bookworm AS rust-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src/monitor
COPY monitor/ .
RUN cargo build --release

# ─────────────────────────────────────────────
# Stage 3：Runtime image
# ─────────────────────────────────────────────
FROM ubuntu:22.04 AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libseccomp2 \
    libcap2 \
    busybox-static \
    && rm -rf /var/lib/apt/lists/*

# 可執行檔
COPY --from=c-builder    /src/core/build/sentinelbox                       /usr/local/bin/sentinelbox
COPY --from=rust-builder /src/monitor/target/release/sentinelbox-monitor   /usr/local/bin/sentinelbox-monitor

# Profile JSON
COPY profiles/ /etc/sentinelbox/profiles/

# 建立最小 busybox rootfs（沙盒內的 lowerdir）
RUN mkdir -p /srv/rootfs/{bin,sbin,usr/bin,usr/sbin,etc,proc,sys,dev,tmp,var/log} \
    && cp /bin/busybox /srv/rootfs/bin/busybox \
    && /srv/rootfs/bin/busybox --install -s /srv/rootfs/bin \
    && chmod 1777 /srv/rootfs/tmp

# audit DB 目錄（掛 volume 才能跨 container 保留歷史）
RUN mkdir -p /var/lib/sentinelbox

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 預設環境變數（可被 docker run -e 覆寫）
ENV SENTINELBOX_PROFILE=strict \
    SENTINELBOX_DB=/var/lib/sentinelbox/audit.db \
    SENTINELBOX_LOG=info

VOLUME /var/lib/sentinelbox

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["--help"]
