# Contributing to SentinelBox

Thank you for your interest in contributing to SentinelBox! This project aims to bridge the gap between high-performance Linux kernel security and AI Agent autonomy. As a contributor, you help ensure that LLM-generated code can be executed safely and transparently.

## 1. Development Environment Setup

To contribute to the core engine, you need a Linux environment meeting the following requirements:
*   **Kernel**: Linux 5.15 or newer (Required for Seccomp User Notification and Cgroup v2).
*   **Compiler**: `gcc` or `clang` (for C), `rustc` and `cargo` (for Rust).
*   **Libraries**: `libseccomp-dev`, `pkg-config`, `libelf-dev`.
*   **Python**: Version 3.10+ (for MCP Server development).

### Setup Command (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y build-essential libseccomp-dev libelf-dev clang llvm cargo python3-pip
```

## 2. Project Structure

*   `/core`: C-based isolation engine (Namespaces, OverlayFS, pivot_root).
*   `/monitor`: Rust-based security monitor (Seccomp UserNotif handler, eBPF telemetry).
*   `/mcp-server`: AI Orchestration layer (Semantic translator, MCP implementation).
*   `/ui`: React-based real-time dashboard.
*   `/docs`: Technical manuals and man pages.

## 3. Contribution Workflow

### Step 1: Issue Discussion
Before starting major work, please open an issue to discuss your proposed changes. This ensures alignment with the project's architectural mandates.

### Step 2: Coding Standards
*   **C Core**: Follow the [Linux Kernel Coding Style](https://www.kernel.org/doc/html/latest/process/coding-style.html). Use `indent` if necessary.
*   **Rust Monitor**: Follow standard `rustfmt` rules. Use `clippy` to check for idiomatic improvements.
*   **Documentation**: All new features must include updates to the `man` page and inline comments explaining kernel-level side effects.

### Step 3: Specific Tasks
*   **Adding a Syscall Filter**: Update the BPF filter in `/monitor` and ensure the syscall is correctly mapped in the `strict` profile.
*   **Adding a Semantic Mapping**: If a new syscall failure is intercepted, add its natural language explanation in `/mcp-server/mappings/`.

## 4. Testing Requirements

SentinelBox is a security tool; therefore, **validation is mandatory**.
1.  **Regression Testing**: Run `make test` to ensure existing isolation primitives still function.
2.  **Security Testing**: Create a proof-of-concept script that attempts to bypass your new feature. Verify that it is correctly blocked and logged.
3.  **Performance Check**: Ensure that new syscall interceptions do not introduce latency exceeding 1ms for the round-trip notification.

## 5. Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/):
*   `feat`: A new feature (e.g., `feat(core): add network namespace isolation`)
*   `fix`: A bug fix (e.g., `fix(seccomp): handle EINTR in notification loop`)
*   `docs`: Documentation only changes
*   `perf`: A code change that improves performance

## 6. Submission Process

1.  Fork the repository and create your branch from `main`.
2.  Ensure all tests pass.
3.  Submit a Pull Request with a detailed description of the security impact and technical approach.
4.  Wait for a maintainer review. All kernel-level changes require at least one detailed security audit.

---

**By contributing to SentinelBox, you agree that your contributions will be licensed under the MIT License.**
