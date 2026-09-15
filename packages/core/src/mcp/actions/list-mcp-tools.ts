import { z } from "zod";

import { defineAction } from "../../action.js";
import { listVisibleMcpTools } from "../../mcp-client/app-api.js";

export default defineAction({
  description:
    "List MCP tools visible to the authenticated app request. Returns tool contracts only; server credentials and tokens are never exposed.",
  agentTool: false,
  requiresAuth: true,
  schema: z.object({
    serverId: z.string().trim().min(1).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: ({ serverId }) => listVisibleMcpTools({ serverId }),
});
