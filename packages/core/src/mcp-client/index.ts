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
  buildMcpToolName,
  parseMcpToolName,
  MCP_TOOL_PREFIX,
  type McpTool,
  type McpClientManagerOptions,
} from "./manager.js";

export {
  listRemoteServers,
  addRemoteServer,
  addFirstPartyRemoteServer,
  isFirstPartyRemoteEndpointTrusted,
  removeRemoteServer,
  validateRemoteUrl,
  normalizeServerName,
  mergedConfigKey,
  parseMergedKey,
  hashEmail,
  toHttpServerConfig,
  toHttpServerConfigAsync,
  materializeHeaders,
  type RemoteMcpScope,
  type StoredRemoteMcpServer,
} from "./remote-store.js";

export {
  areBuiltinMcpCapabilitiesSupported,
  BUILTIN_MCP_CAPABILITIES,
  getBuiltinMcpCapability,
  isBuiltinMcpCapabilityAvailable,
  listSupportedBuiltinMcpCapabilities,
  normalizeBuiltinMcpCapabilityIds,
  toBuiltinMcpServerConfig,
  type BuiltinMcpCapability,
  type BuiltinMcpCapabilityId,
} from "./builtin-capabilities.js";

export {
  builtinMcpCapabilitiesSettingsKey,
  listEnabledBuiltinMcpCapabilities,
  setEnabledBuiltinMcpCapabilities,
  setBuiltinMcpCapabilityEnabled,
  type StoredBuiltinMcpCapabilities,
} from "./builtin-store.js";

export {
  mountMcpServersRoutes,
  buildMergedConfig,
  builtinMergedConfigKey,
  startMcpConfigRefresh,
  type ClientBuiltinCapability,
} from "./routes.js";

export {
  mountMcpHubRoutes,
  listHubServers,
  getHubStatus,
  isHubServeEnabled,
  isHubConsumeEnabled,
  type HubServerRecord,
  type HubServersResponse,
} from "./hub-routes.js";

export { fetchHubServers } from "./hub-client.js";

export { isMcpToolAllowedForRequest } from "./visibility.js";
import { isMcpToolAllowedForRequest } from "./visibility.js";
export {
  configureScreenMemory,
  queryScreenMemoryContext,
  readScreenMemoryStatus,
  type ScreenMemoryConfig,
  type ScreenMemoryContextItem,
  type ScreenMemoryQueryResult,
  type ScreenMemoryStatus,
} from "./screen-memory-local.js";
export {
  MCP_ACTION_RESULT_MARKER,
  isMcpActionResult,
  type AgentMcpAppPayload,
  type AgentMcpAppResourceContent,
  type McpActionResult,
} from "./app-result.js";
import {
  getToolUiResourceUri,
  isToolVisibilityAppOnly,
  isToolVisibilityModelOnly,
} from "@modelcontextprotocol/ext-apps/app-bridge";

import { MCP_APP_MIME_TYPE } from "../action.js";
/**
 * Convert MCP tools into `ActionEntry` values suitable for registration in
 * the agent's action registry. Each tool is marked `http: false` so it's
 * never auto-mounted as an HTTP endpoint — MCP tools are agent-only.
 */
import type { ActionEntry } from "../agent/production-agent.js";
import {
  MCP_ACTION_RESULT_MARKER,
  toolForMcpAppPayload,
  type AgentMcpAppPayload,
  type AgentMcpAppResourceContent,
  type McpActionResult,
} from "./app-result.js";
import type { McpClientManager, McpTool } from "./manager.js";

export function mcpToolsToActionEntries(
  manager: McpClientManager,
): Record<string, ActionEntry> {
  const entries: Record<string, ActionEntry> = {};
  for (const tool of manager.getTools().filter(isVisibleToModel)) {
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
  for (const tool of manager.getTools().filter(isVisibleToModel)) {
    current.add(tool.name);
    target[tool.name] = mcpToolToActionEntry(manager, tool);
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
    ...(tool.annotations?.readOnlyHint === true ? { readOnly: true } : {}),
    run: async (args: Record<string, string>) => {
      // Defense-in-depth: even if a cross-scope MCP tool somehow makes it
      // into the LLM's visible tool list, reject invocation here so we never
      // execute a user's credentials on behalf of another user.
      if (!isMcpToolAllowedForRequest(tool.name)) {
        return buildMcpErrorActionResult(
          tool,
          args,
          `Error: MCP tool ${tool.name} is not available in the current request scope.`,
        );
      }
      try {
        const result = await manager.callTool(tool.name, args);
        return await buildMcpActionResult(manager, tool, args, result);
      } catch (err: any) {
        return buildMcpErrorActionResult(
          tool,
          args,
          `Error calling MCP tool ${tool.name}: ${err?.message ?? err}`,
        );
      }
    },
  };
}

function isVisibleToModel(tool: McpTool): boolean {
  try {
    return !isToolVisibilityAppOnly(tool.raw as any);
  } catch {
    return true;
  }
}

export function isVisibleToMcpApp(tool: McpTool): boolean {
  try {
    return !isToolVisibilityModelOnly(tool.raw as any);
  } catch {
    return true;
  }
}

export function flattenMcpToolResult(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as any).content)
  ) {
    const parts = (result as any).content as Array<Record<string, any>>;
    const text = parts.map(formatMcpContentPart).join("\n");
    const fallback =
      text ||
      (hasStructuredContent(result)
        ? JSON.stringify((result as any).structuredContent, null, 2)
        : "(no output)");
    if ((result as any).isError) return `Error: ${fallback}`;
    return fallback;
  }
  return typeof result === "string" ? result : JSON.stringify(result);
}

function formatMcpContentPart(part: Record<string, any>): string {
  if (part?.type === "text" && typeof part.text === "string") {
    return part.text;
  }
  if (part?.type === "image") {
    return `[image: ${part?.mimeType ?? "unknown"}]`;
  }
  if (part?.type === "resource") {
    const resource = part.resource ?? {};
    const uri = typeof resource.uri === "string" ? ` ${resource.uri}` : "";
    return `[resource: ${resource.mimeType ?? "unknown"}${uri}]`;
  }
  if (part?.type === "resource_link") {
    const uri = typeof part.uri === "string" ? ` ${part.uri}` : "";
    return `[resource: ${part.mimeType ?? "unknown"}${uri}]`;
  }
  return JSON.stringify(part);
}

function hasStructuredContent(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    Object.prototype.hasOwnProperty.call(result, "structuredContent")
  );
}

async function buildMcpActionResult(
  manager: McpClientManager,
  tool: McpTool,
  input: Record<string, unknown>,
  raw: unknown,
): Promise<McpActionResult> {
  const text = flattenMcpToolResult(raw);
  const mcpApp = await extractMcpAppPayload(manager, tool, input, raw);
  return {
    [MCP_ACTION_RESULT_MARKER]: true,
    text,
    raw,
    serverId: tool.source,
    toolName: tool.name,
    originalToolName: tool.originalName,
    input,
    ...(mcpApp ? { mcpApp } : {}),
  };
}

function buildMcpErrorActionResult(
  tool: McpTool,
  input: Record<string, unknown>,
  text: string,
): McpActionResult {
  return {
    [MCP_ACTION_RESULT_MARKER]: true,
    text,
    raw: {
      isError: true,
      content: [{ type: "text", text }],
    },
    serverId: tool.source,
    toolName: tool.name,
    originalToolName: tool.originalName,
    input,
  };
}

async function extractMcpAppPayload(
  manager: McpClientManager,
  tool: McpTool,
  input: Record<string, unknown>,
  raw: unknown,
): Promise<AgentMcpAppPayload | undefined> {
  const inlineResource = findInlineMcpAppResource(raw);
  const resourceUri =
    inlineResource?.uri ??
    resourceUriFromTool(tool) ??
    resourceUriFromResult(raw);
  if (!resourceUri) return undefined;

  const resource =
    inlineResource ?? (await readMcpAppResource(manager, tool, resourceUri));

  return {
    serverId: tool.source,
    toolName: tool.name,
    originalToolName: tool.originalName,
    resourceUri,
    toolInput: input,
    toolResult:
      raw && typeof raw === "object"
        ? ({ ...(raw as Record<string, unknown>) } as Record<string, unknown>)
        : { content: [{ type: "text", text: String(raw ?? "") }] },
    tool: toolForMcpAppPayload(tool),
    ...(resource ? { resource } : {}),
  };
}

function resourceUriFromTool(tool: McpTool): string | undefined {
  try {
    return getToolUiResourceUri(tool.raw as any);
  } catch {
    return undefined;
  }
}

function resourceUriFromResult(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const meta = (raw as any)._meta;
  const nested = meta?.ui?.resourceUri;
  if (typeof nested === "string" && nested.startsWith("ui://")) return nested;
  const flat = meta?.["ui/resourceUri"] ?? meta?.["ui.resourceUri"];
  if (typeof flat === "string" && flat.startsWith("ui://")) return flat;
  return findInlineMcpAppResource(raw)?.uri;
}

function findInlineMcpAppResource(
  raw: unknown,
): AgentMcpAppResourceContent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const content = Array.isArray((raw as any).content)
    ? ((raw as any).content as unknown[])
    : [];
  for (const part of content) {
    const resource = normalizeMcpAppResourceContent(part);
    if (resource) return resource;
  }
  return undefined;
}

function normalizeMcpAppResourceContent(
  part: unknown,
): AgentMcpAppResourceContent | undefined {
  if (!part || typeof part !== "object") return undefined;
  const candidate =
    (part as any).type === "resource"
      ? (part as any).resource
      : ((part as any).resource ?? part);
  if (!candidate || typeof candidate !== "object") return undefined;
  const uri = (candidate as any).uri;
  if (typeof uri !== "string" || !uri.startsWith("ui://")) return undefined;
  const mimeType =
    typeof (candidate as any).mimeType === "string"
      ? (candidate as any).mimeType
      : undefined;
  if (mimeType && !mimeType.includes(MCP_APP_MIME_TYPE)) return undefined;
  const text =
    typeof (candidate as any).text === "string"
      ? (candidate as any).text
      : undefined;
  const blob =
    typeof (candidate as any).blob === "string"
      ? (candidate as any).blob
      : undefined;
  const meta =
    (candidate as any)._meta && typeof (candidate as any)._meta === "object"
      ? ((candidate as any)._meta as Record<string, unknown>)
      : (part as any)._meta && typeof (part as any)._meta === "object"
        ? ((part as any)._meta as Record<string, unknown>)
        : undefined;
  return {
    uri,
    ...(mimeType ? { mimeType } : {}),
    ...(text ? { text } : {}),
    ...(blob ? { blob } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

async function readMcpAppResource(
  manager: McpClientManager,
  tool: McpTool,
  resourceUri: string,
): Promise<AgentMcpAppResourceContent | undefined> {
  try {
    const result = await manager.readResourceForTool(tool.name, resourceUri);
    const contents = Array.isArray((result as any)?.contents)
      ? ((result as any).contents as unknown[])
      : [];
    for (const content of contents) {
      const resource = normalizeMcpAppResourceContent(content);
      if (
        resource?.uri === resourceUri ||
        (resource && contents.length === 1)
      ) {
        return resource;
      }
    }
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to read MCP App resource ${resourceUri}: ${err?.message ?? err}`,
    );
  }
  return undefined;
}
