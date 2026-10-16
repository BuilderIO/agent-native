import type { ActionRunContext } from "../action.js";
import { readClientInfoFromRequest } from "./analytics.js";

export interface McpCallAttributionInput {
  /** The `tools/call` request as the handler received it. */
  request: unknown;
  /** `ctx.mcpReq.envelope`: the reserved `_meta` keys the SDK lifted out. */
  envelope: unknown;
  oauthClientId: string | undefined;
  /** The call consumed a grant after the MCP client accepted its elicitation. */
  clientAccepted: boolean;
}

/**
 * The client and approval facts the audit trail records for one MCP
 * `tools/call`. Only `oauthClientId` comes from a credential this server
 * issued. The name and version are whatever the client sent as `clientInfo`.
 */
export function mcpCallAttribution(
  input: McpCallAttributionInput,
): Pick<ActionRunContext, "mcpClient" | "mcpClientAccepted"> {
  // 2026-07-28 requests carry clientInfo in the envelope, which the SDK
  // removes from the `_meta` the handler sees. Older requests leave it there.
  const lifted = readClientInfoFromRequest({
    _meta:
      input.envelope && typeof input.envelope === "object"
        ? (input.envelope as Record<string, unknown>)
        : undefined,
  });
  const info =
    lifted.clientName || lifted.clientVersion
      ? lifted
      : readClientInfoFromRequest(
          input.request as Parameters<typeof readClientInfoFromRequest>[0],
        );
  const mcpClient = {
    ...(info.clientName ? { name: info.clientName } : {}),
    ...(info.clientVersion ? { version: info.clientVersion } : {}),
    ...(input.oauthClientId ? { oauthClientId: input.oauthClientId } : {}),
  };
  return {
    ...(Object.keys(mcpClient).length > 0 ? { mcpClient } : {}),
    ...(input.clientAccepted ? { mcpClientAccepted: true as const } : {}),
  };
}
