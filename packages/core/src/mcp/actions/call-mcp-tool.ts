import { z } from "zod";

import { defineAction } from "../../action.js";
import { callMcpTool } from "../../mcp-client/app-api.js";

export default defineAction({
  description:
    "Call an MCP tool visible to the authenticated app request by server id and original tool name. Server credentials and tokens are never exposed.",
  agentTool: false,
  requiresAuth: true,
  schema: z.object({
    serverId: z.string().trim().min(1),
    toolName: z.string().trim().min(1),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  run: ({ serverId, toolName, arguments: args }) =>
    callMcpTool(serverId, toolName, args),
});
