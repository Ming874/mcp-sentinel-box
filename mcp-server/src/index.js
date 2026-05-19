import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { SemanticTranslator } from "./services/translator.js";
import { z } from "zod";
const translator = new SemanticTranslator();
const server = new Server({
    name: "sentinelbox-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
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
        ],
    };
});
/**
 * Handle tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
        case "translate_error": {
            const args = request.params.arguments;
            const feedback = translator.translate(args);
            return {
                content: [
                    {
                        type: "text",
                        text: feedback,
                    },
                ],
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
//# sourceMappingURL=index.js.map