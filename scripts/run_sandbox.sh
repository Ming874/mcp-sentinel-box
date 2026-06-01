#!/usr/bin/env bash
# run_sandbox.sh - The recommended way to run the sandbox in WSL2
set -euo pipefail

# This script uses systemd-run to ensure cgroup delegation works properly in WSL2.
# Usage: ./scripts/run_sandbox.sh --profile=strict -- /bin/sh -c "echo hello"

echo "[WSL-Helper] Starting sandbox with cgroup delegation..."
systemd-run --user --scope --property=Delegate=yes bash "$(dirname "$0")/run.sh" "$@"
