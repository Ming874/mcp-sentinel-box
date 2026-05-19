# 頂層 Makefile - SentinelBox 一鍵建置
#
# 目標：
#   make           編譯 core (C) 與 monitor (Rust)
#   make core      只編 core
#   make monitor   只編 monitor
#   make clean     清理所有產物
#   make test      跑 tests/run_tests.sh
#   make rootfs    建立 busybox rootfs
#   make help      顯示說明
#
# 依賴 (Ubuntu 22.04+)：
#   build-essential libseccomp-dev libcap-dev libelf-dev clang
#   cargo (rustup default stable)
#   busybox-static (僅 rootfs 需要)

.PHONY: all core monitor clean test rootfs help install

all: core monitor

core:
	$(MAKE) -C core

monitor:
	cd monitor && cargo build --release

clean:
	$(MAKE) -C core clean
	cd monitor && cargo clean
	rm -f sentinelbox.db sentinelbox.db-wal sentinelbox.db-shm

test:
	bash tests/run_tests.sh

rootfs:
	bash scripts/setup_rootfs.sh ./rootfs/busybox

install: all
	$(MAKE) -C core install
	install -m 0755 monitor/target/release/sentinelbox-monitor /usr/local/bin/sentinelbox-monitor

help:
	@echo "可用目標："
	@echo "  make / make all   編譯 core + monitor"
	@echo "  make core         只編 core (C 隔離引擎)"
	@echo "  make monitor      只編 monitor (Rust 安全哨兵)"
	@echo "  make rootfs       建立 ./rootfs/busybox"
	@echo "  make test         跑整合測試"
	@echo "  make clean        清除所有產物"
	@echo "  make install      安裝到 /usr/local/bin (需 sudo)"
