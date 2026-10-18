import { getVerifiedMcpCredentialFromEvent } from "../server/request-context.js";
import { boundAuditOverride } from "./invocation-override.js";
import type { AuditApproval } from "./types.js";

// Registered, so an attribution made by another loaded copy of this module
// still passes the check.
const auditAttributionBrand: unique symbol = Symbol.for(
  "@agent-native/core/audit-attribution",
);

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
  approval?: AuditApproval;
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

/**
 * Values one invocation's audit rows record in place of its run's own. An
 * approved A2A replay links its rows to the paused task and names the review
 * page, without running in that task's journal or ledger. Bound to that
 * invocation's context object, never a field on it.
 */
export type AuditOverride = Partial<
  Pick<
    AuditAttributionFields,
    | "threadId"
    | "turnId"
    | "runId"
    | "networkProtocol"
    | "networkId"
    | "networkPeer"
    | "approval"
  >
>;

/** The run context attribution reads from; an `ActionRunContext` is one. */
export type AuditAttributionSource = Partial<
  Omit<AuditAttributionFields, "approval">
>;

/** A recorder was given no attribution, or one `auditAttribution` did not make. */
export class AuditAttributionError extends Error {
  constructor(recorder: string) {
    super(
      `${recorder} needs an attribution from auditAttribution(ctx) or routeAuditAttribution(event).`,
    );
    this.name = "AuditAttributionError";
  }
}

export function assertAuditAttribution(
  value: unknown,
  recorder: string,
): asserts value is AuditAttribution {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { [auditAttributionBrand]?: unknown })[auditAttributionBrand] !==
      true
  ) {
    throw new AuditAttributionError(recorder);
  }
}

/**
 * Attribution for a write made inside an action, from its run context. With
 * no context the source is `http`.
 */
export function auditAttribution(
  ctx: AuditAttributionSource | undefined,
): AuditAttribution {
  const override = ctx ? boundAuditOverride(ctx)?.override : undefined;
  // Every field listed, so a field added to the set fails to compile until
  // it is carried here.
  const fields: {
    [K in keyof Required<AuditAttributionFields>]:
      | AuditAttributionFields[K]
      | undefined;
  } = {
    caller: ctx?.caller ?? "http",
    threadId: override?.threadId ?? ctx?.threadId,
    turnId: override?.turnId ?? ctx?.turnId,
    runId: override?.runId ?? ctx?.runId,
    networkProtocol: override?.networkProtocol ?? ctx?.networkProtocol,
    networkId: override?.networkId ?? ctx?.networkId,
    networkPeer: override?.networkPeer ?? ctx?.networkPeer,
    approvedToolCallKey: ctx?.approvedToolCallKey,
    mcpClient: ctx?.mcpClient,
    mcpClientAccepted: ctx?.mcpClientAccepted,
    approval: override?.approval,
  };
  return { ...fields, [auditAttributionBrand]: true } as AuditAttribution;
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
