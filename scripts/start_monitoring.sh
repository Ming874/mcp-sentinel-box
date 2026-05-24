#!/bin/bash
BASE_DIR=$(pwd)

echo "Starting Node.js Bridge Server on port 3001..."
cd "$BASE_DIR/server" && npm install && node index.js &
BRIDGE_PID=$!

echo "Starting React Dashboard on port 3000..."
cd "$BASE_DIR/dashboard" && npm install && npm run dev -- --host 0.0.0.0 --port 3000 &
UI_PID=$!

echo "Monitoring services started."
echo "Bridge PID: $BRIDGE_PID"
echo "UI PID: $UI_PID"
echo "Press Ctrl+C to stop both."

# Cleanup on exit
trap "echo 'Stopping services...'; kill $BRIDGE_PID $UI_PID; exit" SIGINT SIGTERM

wait $BRIDGE_PID $UI_PID

