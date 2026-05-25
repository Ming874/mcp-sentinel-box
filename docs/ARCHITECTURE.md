# SentinelBox Architecture

SentinelBox bridges the gap between low-level system constraints and AI reasoning capabilities.

## High-Performance & Security Optimizations
- **Immediate Resource Retrieval (`wait4`)**: Replaces traditional `waitpid` to fetch execution exit status and comprehensive `rusage` (User/System CPU time, Max RSS) in a single system call, vital for high-performance AI execution testing.
- **Memory Leak Prevention (`PR_SET_DUMPABLE`)**: Enforces zero core dumps from sandboxed processes, preventing host information leaks even if the sandbox crashes.
- **Seccomp Rule Ordering**: Prioritizes `ALLOW` rules during libseccomp filter construction, potentially optimizing BPF execution trees for high-frequency safe system calls.
- **Efficient Namespace Setup (`clone`)**: Uses `clone()` instead of `unshare()` to minimize context switches when spawning sandboxed processes.

## The Semantic Translation Loop

1. **AI Action**: AI generates code and executes it within the Sandbox.
2. **Execution Blocked**: Linux Seccomp-BPF filters catch a forbidden system call (e.g., `socket`).
3. **Core Telemetry**: The kernel sends `SIGSYS` back to the isolation engine.
4. **MCP Translation**: The `mcp-server` translates `SIGSYS + socket` into semantic text.
5. **AI Feedback**: AI receives: "Action Denied: Your code attempted to perform a restricted network call."
6. **Self-Correction**: AI modifies the code and retries.
