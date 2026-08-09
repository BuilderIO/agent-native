import type {
  McpServer,
  McpServersList,
  TestMcpUrlResult,
} from "@agent-native/core/client/resources";
import type { McpServerConfig } from "@agent-native/core/mcp-client";

/** IPC names for the shared core MCP settings surface in Desktop. */
export const CHAT_FIRST_MCP_IPC = {
  LIST: "chat-first:mcp:list",
  CREATE: "chat-first:mcp:create",
  DELETE: "chat-first:mcp:delete",
  RECONNECT: "chat-first:mcp:reconnect",
  TEST: "chat-first:mcp:test",
  TEST_EXISTING: "chat-first:mcp:test-existing",
  IMPORT_PLUGIN: "chat-first:mcp:import-plugin",
} as const;

export type ChatFirstMcpServer = McpServer;
export type ChatFirstMcpServersList = McpServersList;
export type ChatFirstMcpTestResult = TestMcpUrlResult;

export interface ChatFirstMcpRuntimeConfig {
  servers: Record<string, McpServerConfig>;
  source: "settings";
}

export interface ChatFirstMcpPluginImportResult {
  ok: boolean;
  plugin?: {
    name: string;
    version?: string;
  };
  skills?: number;
  mcpServers?: number;
  skipped?: Array<{
    component: "skill" | "mcp";
    name?: string;
    reason: string;
  }>;
  warnings?: string[];
  targetDir?: string;
  error?: string;
}
