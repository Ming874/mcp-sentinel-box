# core/Makefile - SentinelBox C 隔離引擎建置設定
#
# 目標：產生 build/sentinelbox 執行檔，是整個專案的進入點。
# 依賴：libseccomp-dev、libcap-dev、libc6-dev、build-essential。
#
# 使用：
#   make            # 編譯
#   make clean      # 清理
#   make install    # 安裝到系統 (DESTDIR / PREFIX 可指定)
#   make debug      # debug 編譯（-O0 -g + AddressSanitizer）

CC          ?= gcc
PREFIX      ?= /usr/local
DESTDIR     ?=

# 嚴格 warning，配合 Linux Kernel coding style，提早抓 bug
CFLAGS_BASE := -std=gnu11 -Wall -Wextra -Wshadow -Wpointer-arith \
               -Wstrict-prototypes -Wmissing-prototypes -Wno-unused-parameter \
               -D_GNU_SOURCE -Iinclude
CFLAGS_REL  := -O2 -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIE
CFLAGS_DBG  := -O0 -g3 -fsanitize=address,undefined -fno-omit-frame-pointer

LDFLAGS_REL := -pie -Wl,-z,relro,-z,now
LDFLAGS_DBG := -fsanitize=address,undefined

# 鏈結 libseccomp（syscall filter）與 libcap（capability 管理）
LIBS        := -lseccomp -lcap

SRC_DIR     := src
INC_DIR     := include
BUILD_DIR   := build
OBJ_DIR     := $(BUILD_DIR)/obj
BIN         := $(BUILD_DIR)/sentinelbox

SRCS := $(wildcard $(SRC_DIR)/*.c)
OBJS := $(patsubst $(SRC_DIR)/%.c,$(OBJ_DIR)/%.o,$(SRCS))

CFLAGS  := $(CFLAGS_BASE) $(CFLAGS_REL)
LDFLAGS := $(LDFLAGS_REL)

.PHONY: all clean install debug help

all: $(BIN)

debug: CFLAGS  := $(CFLAGS_BASE) $(CFLAGS_DBG)
debug: LDFLAGS := $(LDFLAGS_DBG)
debug: $(BIN)

$(BIN): $(OBJS) | $(BUILD_DIR)
	$(CC) $(LDFLAGS) -o $@ $(OBJS) $(LIBS)
	@echo ">>> 已建置 $@"

$(OBJ_DIR)/%.o: $(SRC_DIR)/%.c | $(OBJ_DIR)
	$(CC) $(CFLAGS) -c -o $@ $<

$(BUILD_DIR) $(OBJ_DIR):
	mkdir -p $@

install: $(BIN)
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 0755 $(BIN) $(DESTDIR)$(PREFIX)/bin/sentinelbox

clean:
	rm -rf $(BUILD_DIR)

help:
	@echo "make / make all   建置 release"
	@echo "make debug        建置 debug (ASan + UBSan)"
	@echo "make install      安裝到 \$$PREFIX/bin (預設 /usr/local)"
	@echo "make clean        清除產物"
