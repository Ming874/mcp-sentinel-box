#!/bin/bash
cat <<EOF > /tmp/tiny.c
#include <stdio.h>
int main() { printf("tiny static\n"); return 0; }
EOF
gcc -static /tmp/tiny.c -o /tmp/tiny.bin
B64=$(base64 -w0 /tmp/tiny.bin)
bash scripts/run.sh -- /bin/sh -c "echo $B64 | base64 -d > /tmp/exe && chmod +x /tmp/exe && /tmp/exe"
