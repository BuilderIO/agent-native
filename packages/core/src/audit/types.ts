export type AuditStatus = "success" | "error" | "denied";

export type AuditActorKind = "agent" | "human" | "system";

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
}
