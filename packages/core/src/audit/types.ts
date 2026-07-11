/**
 * Types for the framework audit log.
 *
 * The audit log is a durable, complete, access-scoped, append-only record of
 * *who mutated what app data, when, from where, and — when it was the agent —
 * in which run*. It is deliberately distinct from observability (sampled
 * agent-run telemetry) and tracking (fire-and-forget product analytics): audit
 * rows are complete, locally queryable, and scoped to the data they describe.
 *
 * Capture happens automatically at the action-execution seam (`defineAction`):
 * every mutating action records an audit event after it runs. Read-only (GET /
 * `readOnly`) actions are skipped unless they opt in via `audit.onRead`.
 */

/** Outcome of an audited action call. */
export type AuditStatus = "success" | "error" | "denied";

/**
 * Who performed the mutation.
 * - `agent` — the in-app assistant / sub-agents / A2A (caller `"tool"`).
 * - `human` — a person via the UI, HTTP, CLI, or an external MCP client.
 * - `system` — no resolved identity (background jobs, schedules).
 */
export type AuditActorKind = "agent" | "human" | "system";

export type AuditVisibility = "private" | "org" | "public";

/**
 * The resource an action mutated, plus the ownership used to scope who can
 * read the resulting audit event. Returned by an action's `audit.target`.
 *
 * `ownerEmail` / `orgId` / `visibility` default to the actor's identity when
 * omitted, which is correct for the common case where a user mutates their own
 * data. Provide them explicitly when a user edits a resource owned by someone
 * else so the *owner* sees the change in their audit trail.
 */
export interface AuditTarget {
  type?: string;
  id?: string;
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: AuditVisibility;
}

/** Metadata about the call, passed to `audit.target` / `audit.summary`. */
export interface AuditCallMeta {
  status: AuditStatus;
  caller: string;
  userEmail?: string;
  orgId?: string | null;
}

/**
 * Per-action audit configuration, set on `defineAction({ audit })`.
 *
 * Audit is **default-on for mutating actions** — you only need this object to
 * *tune* capture (declare the target, customize the summary) or to opt a
 * read-only action in / a noisy action out.
 */
export interface ActionAuditConfig {
  /**
   * Force audit on (`true`) or off (`false`). Overrides every default,
   * including the read-only skip and the high-frequency denylist. When
   * omitted, mutating actions are audited and read-only actions are not.
   */
  enabled?: boolean;
  /**
   * Audit this action even though it is read-only (GET). Use for sensitive
   * reads worth recording — secret access, bulk export. Ignored when
   * `enabled` is set explicitly.
   */
  onRead?: boolean;
  /** Capture the (redacted) call arguments. Default `true`. */
  recordInputs?: boolean;
  /** Resolve the mutated resource + its ownership for scoped reads. */
  target?: (
    args: any,
    result: unknown,
    meta: AuditCallMeta,
  ) => AuditTarget | null | undefined;
  /** Build a short human-readable summary line for the event. */
  summary?: (args: any, result: unknown, meta: AuditCallMeta) => string;
}

/** A persisted audit event. */
export interface AuditEvent {
  id: string;
  createdAt: number;
  /** Action name (the registry key, e.g. `delete-recording`). */
  action: string;
  /** Invocation surface: tool | frontend | http | cli | mcp | a2a. */
  caller: string;
  actorKind: AuditActorKind;
  /** Human on whose behalf it ran — populated even for agent calls. */
  actorEmail: string | null;
  orgId: string | null;
  /** Agent conversation thread, when caller is the agent loop. */
  threadId: string | null;
  /** Agent turn that produced the mutation — the unit of one agent response. */
  turnId: string | null;
  targetType: string | null;
  targetId: string | null;
  status: AuditStatus;
  summary: string | null;
  /** Redacted JSON of the call arguments, or null. */
  input: string | null;
  errorCode: string | null;
  /** Denormalized owner used to scope reads (defaults to the actor). */
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
}

/** Filters for `queryAuditEvents`. */
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
  sinceMs?: number;
  limit?: number;
  /** Skip this many matching rows before applying `limit` (0-based). Used by
   *  `export-audit-events` to page past the per-call `MAX_LIMIT` clamp. */
  offset?: number;
}
