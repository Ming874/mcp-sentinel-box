#!/usr/bin/env bash
# render.sh - 把 .mmd 透過官方 mermaid.ink 渲染為 svg + png
# 用法：./render.sh                # 渲染目錄下所有 .mmd
#       ./render.sh foo.mmd bar.mmd

set -euo pipefail
cd "$(dirname "$0")"

render_one() {
    local src="$1"
    local base="${src%.mmd}"
    # mermaid.ink 接 base64(URL-safe) 編碼後的 raw mermaid source
    local b64
    b64=$(base64 -w0 < "$src" | tr '+/' '-_' | tr -d '=')
    echo "→ $src"
    curl -fsSL "https://mermaid.ink/svg/${b64}" -o "${base}.svg"
    curl -fsSL "https://mermaid.ink/img/${b64}?type=png&bgColor=white" -o "${base}.png"
    echo "  ✓ ${base}.svg  ${base}.png"
}

if [ $# -eq 0 ]; then
    for f in *.mmd; do render_one "$f"; done
else
    for f in "$@"; do render_one "$f"; done
fi
