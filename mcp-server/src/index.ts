import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SemanticTranslator, type TranslationContext } from "./services/translator.js";

const translator = new SemanticTranslator();

const server = new Server(
  {
    name: "sentinelbox-mcp-server",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "translate_error",
        description: "Translates low-level sandbox errors into high-level semantic feedback.",
        inputSchema: {
          type: "object",
          properties: {
            signal: { type: "string", description: "The system signal (e.g., SIGSYS, SIGKILL)." },
            errno: { type: "string", description: "The error number (e.g., EPERM, ENOENT)." },
            syscall: { type: "string", description: "The system call that caused the error." },
            path: { type: "string", description: "The path of the resource involved." },
            details: { type: "string", description: "Any additional raw error details." },
          },
        },
      },
      {
        name: "suggest_repair",
        description: "Suggests a code modification to fix a sandbox security violation.",
        inputSchema: {
          type: "object",
          properties: {
            syscall: { type: "string", description: "The blocked syscall (e.g., socket, open)." },
            original_code: { type: "string", description: "The snippet of code that failed." },
            profile: { type: "string", description: "The active security profile (e.g., strict, datascience)." }
          },
          required: ["syscall", "original_code"]
        }
      }
    ],
  };
});

/**
 * Handle tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "translate_error": {
      const args = request.params.arguments as TranslationContext;
      const feedback = translator.translate(args);
      return {
        content: [{ type: "text", text: feedback }],
      };
    }
    case "suggest_repair": {
      const { syscall, original_code, profile } = request.params.arguments as any;
      let suggestion = "Analyze the logic to remove the prohibited action.";
      
      if (syscall === 'socket' || syscall === 'connect') {
         suggestion = `The code attempts to access the network. In the '${profile || 'strict'}' profile, networking is disabled. \nRepair Suggestion: Replace network requests with local mock data or read from a pre-mounted dataset in the workspace.`;
      } else if (syscall === 'open' || syscall === 'openat') {
         suggestion = `The code attempts to access a restricted filesystem path. \nRepair Suggestion: Only write to the current working directory (/var/lib/sentinelbox or /tmp). Avoid accessing /etc or /sys.`;
      } else if (syscall === 'execve') {
         suggestion = `The code attempts to spawn a new process. \nRepair Suggestion: Use built-in language features instead of spawning external shell commands.`;
      }

      const response = `Based on the blocked syscall '${syscall}', here is the repair strategy:\n${suggestion}\n\nOriginal Code context:\n${original_code}`;
      
      return {
        content: [{ type: "text", text: response }],
      };
    }
    default:
      throw new Error("Unknown tool");
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SentinelBox MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
