import { z } from "zod";

import { defineAction, defineActionErrors } from "../../action.js";
import { getRequestContext } from "../../server/request-context.js";
import { mcpClientConnectionsSchema } from "../../shared/mcp-client-connections.js";
import { listMcpClientConnections } from "../client-connections.js";
import { resolveMcpOAuthIssuer } from "../oauth-route.js";

const errors = defineActionErrors(
  "unauthorized",
  "mcp_connections_unavailable",
);

export default defineAction({
  description:
    "List the current user's external MCP client authorizations for this app and active organization. Returns per-client connected, disconnected, or unknown status and the last server-recorded activity timestamp. Connected means authorization remains valid, not that the client is currently online. Never returns tokens. Unknown means older credentials lack enough metadata to verify their current validity.",
  schema: z.object({}),
  outputSchema: mcpClientConnectionsSchema,
  errors,
  requiresAuth: true,
  readOnly: true,
  parallelSafe: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail?.trim().toLowerCase();
    if (!email)
      return errors.fail("Sign in to view MCP connections.", "unauthorized", {
        statusCode: 401,
      });
    const issuer = resolveMcpOAuthIssuer(getRequestContext()?.requestOrigin);
    if (!issuer)
      return errors.fail(
        "Unable to resolve this app's MCP resource.",
        "mcp_connections_unavailable",
        { statusCode: 503 },
      );
    try {
      return await listMcpClientConnections({
        email,
        orgId: ctx?.orgId ?? null,
        issuer,
      });
    } catch (error) {
      console.error("[mcp-connections] Status lookup failed", error);
      return errors.fail(
        "MCP connection status is unavailable. Try again.",
        "mcp_connections_unavailable",
        { statusCode: 503 },
      );
    }
  },
});
