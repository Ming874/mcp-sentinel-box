#!/usr/bin/env bash
# run_wsl.sh - Helper to run sentinelbox in WSL with correct cgroup delegation
set -euo pipefail

# Get current cgroup path
CG_PATH=$(grep -oP '0::\K.*' /proc/self/cgroup)
echo "Current cgroup: $CG_PATH"

# Enable controllers in current cgroup
echo "+cpu +memory +pids" > "/sys/fs/cgroup$CG_PATH/cgroup.subtree_control" || echo "Warning: Could not enable controllers"

# Run sentinelbox
exec ./core/build/sentinelbox --cgroup-parent="/sys/fs/cgroup$CG_PATH" "$@"
