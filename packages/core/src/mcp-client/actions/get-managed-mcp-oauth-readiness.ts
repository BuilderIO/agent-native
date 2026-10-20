import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { resolveManagedMcpOAuthClient } from "../oauth-routes.js";

export type ManagedMcpOAuthReadiness = {
  hubspot: "configured" | "missing";
};

export default defineAction({
  description:
    "Check whether the workspace has the managed HubSpot MCP OAuth client configured. Returns status only; never returns credential values.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  toolCallable: false,
  run: async (_args, ctx): Promise<ManagedMcpOAuthReadiness> => {
    if (!ctx?.userEmail || !ctx.requestHeaders) {
      fail("Not authenticated.", { statusCode: 401 });
    }

    const client = await resolveManagedMcpOAuthClient(
      new URL("https://mcp.hubspot.com"),
    );
    return { hubspot: client ? "configured" : "missing" };
  },
});
