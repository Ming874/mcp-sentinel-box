#!/usr/bin/env bash
# shoot.sh - 程式碼截圖工作流
#
# 為什麼分兩段：
#   freeze 內建 headless chromium 找不到系統 CJK 字型，CJK 註解會變空白。
#   故走 freeze -> SVG（嵌入 JetBrainsMono ASCII），再用 rsvg-convert (Pango+fontconfig)
#   轉 PNG，缺字會自動 fallback 到系統 Sarasa Fixed TC。
#
# 依賴：
#   - freeze   v0.2.2+ (charmbracelet)
#   - rsvg-convert (librsvg2-bin)
#   - 系統字型：Sarasa Fixed TC（CJK fallback 用）
#
# 用法：./shoot.sh <lang> <start>,<end> <src-relative-to-repo-root> <out-name>
# 例：  ./shoot.sh rust 23,80 monitor/src/telemetry.rs phase3-telemetry-sampling

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

lang="$1"; lines="$2"; src="$3"; out="$4"
tmp="$(mktemp --suffix=.svg)"
trap 'rm -f "$tmp"' EXIT

freeze --language "$lang" --theme github-dark --window \
       --background "#1a1a2e" --margin 20 \
       --font.size 14 --line-height 1.4 --lines "$lines" \
       -o "$tmp" "$REPO/$src"

rsvg-convert -z 2 "$tmp" -o "$HERE/${out}.png"
echo "✓ $HERE/${out}.png"
