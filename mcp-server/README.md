# SentinelBox MCP Server

The `mcp-server` component acts as the translation layer between low-level system execution failures and high-level AI Agent semantic understanding.

## Overview
It implements the Model Context Protocol (MCP) using the `@modelcontextprotocol/sdk`.

### Core Tool: `translate_error`
Translates hard system signals into actionable natural language.

**Input Schema:**
- `signal` (string): e.g. SIGSYS, OOM_KILL
- `errno` (string): e.g. EPERM, ENOENT
- `syscall` (string): The failing system call
- `path` (string): Path of the resource

**Output Example:**
"Action Denied: Your code attempted to perform a restricted system call (socket) that is not allowed in this security profile."
