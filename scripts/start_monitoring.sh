#!/bin/bash
# 取得腳本所在目錄的絕對路徑，並指向專案根目錄
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Starting Node.js Bridge Server on port 3001..."
cd "$PROJECT_ROOT/server" && npm install && node src/index.js &
BRIDGE_PID=$!

echo "Starting React Dashboard on port 3000..."
cd "$PROJECT_ROOT/dashboard" && npm install && npm run dev -- --host 0.0.0.0 --port 3000 &
UI_PID=$!

echo "Monitoring services started."
echo "Bridge PID: $BRIDGE_PID"
echo "UI PID: $UI_PID"
echo "Press Ctrl+C to stop both."

# Cleanup on exit
trap "echo 'Stopping services...'; kill $BRIDGE_PID $UI_PID; exit" SIGINT SIGTERM

wait $BRIDGE_PID $UI_PID

