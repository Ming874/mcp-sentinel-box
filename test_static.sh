#!/bin/bash
B64=$(base64 -w0 /tmp/test.bin)
bash scripts/run.sh -- /bin/sh -c "echo $B64 | base64 -d > /tmp/exe && chmod +x /tmp/exe && /tmp/exe"
