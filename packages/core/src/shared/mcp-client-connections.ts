import { z } from "zod";

export const mcpClientConnectionSchema = z.object({
  client: z.enum([
    "claude",
    "chatgpt",
    "cursor",
    "vscode",
    "claude-code",
    "codex",
    "grok",
    "other",
  ]),
  status: z.enum(["connected", "disconnected", "unknown"]),
  lastUsedAt: z.number().int().nonnegative().nullable(),
});
export const mcpClientConnectionsSchema = z.object({
  connections: z.array(mcpClientConnectionSchema),
});
export type McpClientConnection = z.infer<typeof mcpClientConnectionSchema>;
export type McpClientConnections = z.infer<typeof mcpClientConnectionsSchema>;
