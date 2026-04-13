/**
 * MCP client module — symmetric counterpart to `@agent-native/core/mcp`
 * (the MCP server). Connects to local MCP servers configured in
 * `mcp.config.json` or the `MCP_SERVERS` env var and exposes their tools
 * to the agent-chat tool-use loop.
 */

export {
  loadMcpConfig,
  autoDetectMcpConfig,
  type McpConfig,
  type McpServerConfig,
} from "./config.js";

export {
  McpClientManager,
  parseMcpToolName,
  MCP_TOOL_PREFIX,
  type McpTool,
  type McpClientManagerOptions,
} from "./manager.js";

/**
 * Convert MCP tools into `ActionEntry` values suitable for registration in
 * the agent's action registry. Each tool is marked `http: false` so it's
 * never auto-mounted as an HTTP endpoint — MCP tools are agent-only.
 */
import type { ActionEntry } from "../agent/production-agent.js";
import type { McpClientManager, McpTool } from "./manager.js";

export function mcpToolsToActionEntries(
  manager: McpClientManager,
): Record<string, ActionEntry> {
  const entries: Record<string, ActionEntry> = {};
  for (const tool of manager.getTools()) {
    entries[tool.name] = mcpToolToActionEntry(manager, tool);
  }
  return entries;
}

function mcpToolToActionEntry(
  manager: McpClientManager,
  tool: McpTool,
): ActionEntry {
  return {
    tool: {
      description: tool.description,
      parameters: tool.inputSchema as any,
    },
    http: false,
    run: async (args: Record<string, string>) => {
      try {
        const result = await manager.callTool(tool.name, args);
        // MCP tool results are typically `{ content: [{ type: "text", text: ... }], isError? }`.
        // Flatten text content for the agent's string-based tool result slot.
        if (
          result &&
          typeof result === "object" &&
          Array.isArray((result as any).content)
        ) {
          const parts = (result as any).content as Array<Record<string, any>>;
          const text = parts
            .map((p) => {
              if (p?.type === "text" && typeof p.text === "string")
                return p.text;
              if (p?.type === "image")
                return `[image: ${p?.mimeType ?? "unknown"}]`;
              return JSON.stringify(p);
            })
            .join("\n");
          if ((result as any).isError) return `Error: ${text}`;
          return text || "(no output)";
        }
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (err: any) {
        return `Error calling MCP tool ${tool.name}: ${err?.message ?? err}`;
      }
    },
  };
}
