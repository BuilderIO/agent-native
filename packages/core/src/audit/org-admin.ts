/**
 * Audit helpers for organization settings and admin changes: the default
 * model, the personal-key restriction, service providers, storage, Builder.io
 * connections, and member roles.
 *
 * These events are recorded with `admins` visibility, so owners and admins of
 * the org read them in the organization trail (`list-audit-events` with
 * `scope: "organization"`), the actor reads their own, and other members read
 * none. Without an org the event stays private to the actor.
 *
 * Kept free of DB imports so action modules can import `orgAdminAudit`; the
 * route recorder loads `record.js` on first use, like `action.ts` does.
 */
import type { ActionCaller } from "../action.js";
import type {
  ActionAuditConfig,
  AuditCallMeta,
  AuditStatus,
  AuditTarget,
} from "./types.js";

export function orgAdminAuditTarget(
  type: string,
  id: string | null | undefined,
  orgId: string | null | undefined,
): AuditTarget {
  return {
    type,
    ...(id ? { id } : {}),
    orgId: orgId ?? null,
    visibility: orgId ? "admins" : "private",
  };
}

/**
 * `audit` config for a `defineAction` that changes organization settings or
 * membership. Refused calls are recorded too: a thrown 401/403 records as
 * `denied`.
 */
export function orgAdminAudit(options: {
  targetType: string;
  targetId?: (
    args: any,
    result: unknown,
    meta: AuditCallMeta,
  ) => string | null | undefined;
  summary?: (args: any, result: unknown, meta: AuditCallMeta) => string;
  recordInputs?: boolean;
}): ActionAuditConfig {
  return {
    ...(options.recordInputs === false ? { recordInputs: false } : {}),
    target: (args, result, meta) =>
      orgAdminAuditTarget(
        options.targetType,
        options.targetId?.(args, result, meta),
        meta.orgId,
      ),
    ...(options.summary ? { summary: options.summary } : {}),
  };
}

export interface OrgAdminAuditEventInput {
  /** Name recorded as the event's action, e.g. `builder-connect`. */
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  userEmail: string | null | undefined;
  orgId: string | null | undefined;
  status?: AuditStatus;
  /** Invocation surface. Routes called from the UI are `http`. */
  caller?: ActionCaller;
  /** Recorded as the event's (redacted) input. */
  args?: Record<string, unknown>;
  threadId?: string;
  turnId?: string;
  runId?: string;
  /**
   * The change affects only the actor (a member's own connection), so it stays
   * in their private trail even inside an org.
   */
  personal?: boolean;
}

/**
 * Record an organization settings or admin change from code that is not a
 * `defineAction` run, such as a Nitro route. Best-effort like every audit
 * write: it never throws for a recording failure.
 */
export async function recordOrgAdminAuditEvent(
  input: OrgAdminAuditEventInput,
): Promise<void> {
  const target = orgAdminAuditTarget(
    input.targetType,
    input.targetId,
    input.orgId,
  );
  if (input.personal) target.visibility = "private";
  const { recordActionAudit } = await import("./record.js");
  await recordActionAudit({
    config: {
      enabled: true,
      target: () => target,
      summary: () => input.summary,
    },
    args: input.args ?? {},
    ctx: {
      actionName: input.action,
      caller: input.caller ?? "http",
      userEmail: input.userEmail ?? undefined,
      orgId: input.orgId ?? null,
      threadId: input.threadId,
      turnId: input.turnId,
      runId: input.runId,
    },
    status: input.status ?? "success",
  });
}
