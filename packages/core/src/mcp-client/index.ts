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

export {
  listRemoteServers,
  addRemoteServer,
  removeRemoteServer,
  validateRemoteUrl,
  normalizeServerName,
  mergedConfigKey,
  toHttpServerConfig,
  type RemoteMcpScope,
  type StoredRemoteMcpServer,
} from "./remote-store.js";

export { mountMcpServersRoutes, buildMergedConfig } from "./routes.js";

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

/**
 * Mutate a target action dict in place so it matches the current MCP tool set:
 * - adds new `mcp__*` keys that aren't in target,
 * - removes `mcp__*` keys that no longer exist in the manager,
 * - leaves non-MCP keys untouched.
 *
 * Used by the agent-chat plugin to keep its `prodActions` / `devActions`
 * registries in sync after `McpClientManager.reconfigure()` runs.
 */
export function syncMcpActionEntries(
  manager: McpClientManager,
  target: Record<string, ActionEntry>,
): void {
  const current = new Set<string>();
  for (const tool of manager.getTools()) {
    current.add(tool.name);
    if (!target[tool.name]) {
      target[tool.name] = mcpToolToActionEntry(manager, tool);
    }
  }
  for (const key of Object.keys(target)) {
    if (key.startsWith("mcp__") && !current.has(key)) {
      delete target[key];
    }
  }
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
