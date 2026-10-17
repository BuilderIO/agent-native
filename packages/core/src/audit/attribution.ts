import { getVerifiedMcpCredentialFromEvent } from "../server/request-context.js";

declare const auditAttributionBrand: unique symbol;

interface AuditAttributionFields {
  caller: string;
  threadId?: string;
  turnId?: string;
  runId?: string;
  networkProtocol?: "a2a" | "mcp" | "provider-api";
  networkId?: string;
  networkPeer?: string;
  approvedToolCallKey?: string;
  mcpClient?: { name?: string; version?: string; oauthClientId?: string };
  mcpClientAccepted?: true;
}

/**
 * Where an audited call came from and what vouched for it: its source, the
 * MCP client it reported, the OAuth client of its credential, the approval
 * signal, and its run and network ids. `recordActionAudit` requires one and
 * only {@link auditAttribution} makes one, so a recorder cannot build its own
 * context and store nulls for a field it forgot.
 */
export type AuditAttribution = Readonly<AuditAttributionFields> & {
  readonly [auditAttributionBrand]: true;
};

/** The run context attribution reads from; an `ActionRunContext` is one. */
export type AuditAttributionSource = Partial<AuditAttributionFields>;

/**
 * Attribution for a write made inside an action, from its run context. With
 * no context the source is `http`.
 */
export function auditAttribution(
  ctx: AuditAttributionSource | undefined,
): AuditAttribution {
  // Every field listed, so a field added to the set fails to compile until
  // it is carried here.
  const fields: {
    [K in keyof Required<AuditAttributionFields>]:
      | AuditAttributionFields[K]
      | undefined;
  } = {
    caller: ctx?.caller ?? "http",
    threadId: ctx?.threadId,
    turnId: ctx?.turnId,
    runId: ctx?.runId,
    networkProtocol: ctx?.networkProtocol,
    networkId: ctx?.networkId,
    networkPeer: ctx?.networkPeer,
    approvedToolCallKey: ctx?.approvedToolCallKey,
    mcpClient: ctx?.mcpClient,
    mcpClientAccepted: ctx?.mcpClientAccepted,
  };
  return fields as AuditAttribution;
}

/**
 * Attribution for a write a Nitro route makes outside any action: `mcp` with
 * the credential's OAuth client when the request authenticated with a
 * verified MCP credential, else `http`.
 */
export function routeAuditAttribution(event: {
  context?: Record<string, unknown>;
}): AuditAttribution {
  const credential = getVerifiedMcpCredentialFromEvent(event);
  if (!credential) return auditAttribution({ caller: "http" });
  return auditAttribution({
    caller: "mcp",
    ...(credential.oauthClientId
      ? { mcpClient: { oauthClientId: credential.oauthClientId } }
      : {}),
  });
}
