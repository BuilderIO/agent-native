export type AuditStatus = "success" | "error" | "denied";

export type AuditActorKind = "agent" | "human" | "service" | "system";

/**
 * Source of the accepted authorization signal. `agent-chat` records a
 * person's approval in agent chat. `a2a-review` records the owner's approval
 * of a paused A2A call on its review page. `mcp-client-accepted` records an
 * accepted MCP elicitation response; the server cannot verify who responded.
 * `mcp-review` records the owner's approval of an MCP call on its review page,
 * signed in as the user the call ran for.
 */
export type AuditApproval =
  | "agent-chat"
  | "a2a-review"
  | "mcp-client-accepted"
  | "mcp-review";

/** Verified identity provenance for a request authenticated through A2A. */
export type AuditIdentityAssurance = "user" | "organization" | "org-member";

/**
 * Who can read an event besides its owner.
 * - `private` — the owner only (the default; personal content stays here).
 * - `org` — every member of `org_id`.
 * - `admins` — owners and admins of `org_id`: organization settings and admin
 *   actions. Members still see their own rows through `owner_email`.
 * - `public` — reserved; reads never widen on it.
 */
export type AuditVisibility = "private" | "org" | "admins" | "public";

export interface AuditTarget {
  type?: string;
  id?: string;
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: AuditVisibility;
}

export interface AuditCallMeta {
  status: AuditStatus;
  caller: string;
  userEmail?: string;
  orgId?: string | null;
}

export interface ActionAuditConfig {
  enabled?: boolean;
  onRead?: boolean;
  recordInputs?: boolean;
  target?: (
    args: any,
    result: unknown,
    meta: AuditCallMeta,
  ) => AuditTarget | null | undefined;
  summary?: (args: any, result: unknown, meta: AuditCallMeta) => string;
}

export interface AuditEvent {
  id: string;
  createdAt: number;
  action: string;
  caller: string;
  actorKind: AuditActorKind;
  actorEmail: string | null;
  orgId: string | null;
  threadId: string | null;
  turnId: string | null;
  targetType: string | null;
  targetId: string | null;
  status: AuditStatus;
  summary: string | null;
  input: string | null;
  errorCode: string | null;
  ownerEmail: string | null;
  visibility: AuditVisibility;
  runId?: string | null;
  taskId?: string | null;
  parentTaskId?: string | null;
  sourceKind?: string | null;
  sourcePlatform?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  networkProtocol?: string | null;
  networkId?: string | null;
  networkPeer?: string | null;
  /** App that recorded the event (`app.id`, else `app.name`). Null on rows
   *  written before the column existed or by an app with no identity. */
  app?: string | null;
  /**
   * The name and version an MCP client sent as its `clientInfo` for this
   * `tools/call`. Self-reported: any client can send any value. Null when the
   * call carried none.
   */
  reportedClientName?: string | null;
  reportedClientVersion?: string | null;
  /** The OAuth client the MCP credential was issued to, when it has one. */
  oauthClientId?: string | null;
  /** Source of the accepted authorization signal. MCP client acceptance does
   * not verify who responded. Rows written before the column existed are null.
   */
  approval?: AuditApproval | null;
  /** Verified identity provenance; null on older rows or non-A2A calls. */
  identityAssurance?: AuditIdentityAssurance | null;
}

export interface AuditQueryFilters {
  targetType?: string;
  targetId?: string;
  actorKind?: AuditActorKind;
  actorEmail?: string;
  status?: AuditStatus;
  threadId?: string;
  turnId?: string;
  action?: string;
  taskId?: string;
  runId?: string;
  sourcePlatform?: string;
  /** Only rows recorded by this app. */
  app?: string;
  /** Only rows at or after this Unix epoch (ms). */
  sinceMs?: number;
  /** Only rows strictly before this Unix epoch (ms). */
  beforeMs?: number;
  limit?: number;
  offset?: number;
  /** Sort direction on (createdAt, id). Defaults to newest first. */
  order?: "asc" | "desc";
  /**
   * Keyset position for an incremental pull: only rows strictly after this
   * (createdAt, id) in `asc` order. Stable under concurrent inserts, which
   * `offset` is not.
   */
  after?: { createdAt: number; id: string };
}
