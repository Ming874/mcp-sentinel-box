# SentinelBox Architecture

SentinelBox bridges the gap between low-level system constraints and AI reasoning capabilities.

## The Semantic Translation Loop

1. **AI Action**: AI generates code and executes it within the Sandbox.
2. **Execution Blocked**: Linux Seccomp-BPF filters catch a forbidden system call (e.g., `socket`).
3. **Core Telemetry**: The kernel sends `SIGSYS` back to the isolation engine.
4. **MCP Translation**: The `mcp-server` translates `SIGSYS + socket` into semantic text.
5. **AI Feedback**: AI receives: "Action Denied: Your code attempted to perform a restricted network call."
6. **Self-Correction**: AI modifies the code and retries.
