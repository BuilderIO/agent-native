import { getIntegrationRequestContext } from "../server/request-context.js";
/**
 * Audit capture entry point, called from the `defineAction` audit wrapper after
 * an action runs (success or error). Best-effort: any failure here is swallowed
 * so auditing never breaks the action it observes.
 *
 * This module touches the DB (`store.js`), so `action.ts` loads it lazily via
 * dynamic import on the first audited call — keeping the DB client out of every
 * bundle that merely defines actions.
 */
import {
  deriveActorKind,
  isAuditDisabled,
  shouldRecordAudit,
} from "./config.js";
import { redactArgsToJson } from "./redact.js";
import { insertAuditEvent } from "./store.js";
import type {
  ActionAuditConfig,
  AuditCallMeta,
  AuditEvent,
  AuditStatus,
  AuditTarget,
} from "./types.js";

/** Minimal view of the action run context the recorder needs. */
export interface AuditRunContextLike {
  actionName?: string;
  caller?: string;
  userEmail?: string;
  orgId?: string | null;
  threadId?: string;
  turnId?: string;
}

export interface RecordActionAuditInput {
  config: ActionAuditConfig | undefined;
  args: unknown;
  ctx: AuditRunContextLike | undefined;
  status: AuditStatus;
  result?: unknown;
  error?: unknown;
}

function errorCode(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "object") {
    const e = error as { errorCode?: unknown; code?: unknown; name?: unknown };
    if (typeof e.errorCode === "string") return e.errorCode;
    if (typeof e.code === "string") return e.code;
    if (typeof e.name === "string") return e.name;
  }
  return "error";
}

function safeTarget(
  config: ActionAuditConfig | undefined,
  args: unknown,
  result: unknown,
  meta: AuditCallMeta,
): AuditTarget | null {
  if (!config?.target) return null;
  try {
    return config.target(args, result, meta) ?? null;
  } catch {
    return null;
  }
}

function safeSummary(
  config: ActionAuditConfig | undefined,
  args: unknown,
  result: unknown,
  meta: AuditCallMeta,
): string | null {
  if (!config?.summary) return null;
  try {
    const s = config.summary(args, result, meta);
    return typeof s === "string" ? s.slice(0, 500) : null;
  } catch {
    return null;
  }
}

/**
 * Record one audit event. Resolves the actor, target, ownership (for scoped
 * reads), and redacted inputs, then appends a row. Never throws.
 */
export async function recordActionAudit(
  input: RecordActionAuditInput,
): Promise<void> {
  try {
    if (isAuditDisabled()) return;
    const ctx = input.ctx;
    const actionName = ctx?.actionName;
    // No name → an internal/programmatic run() with no dispatch context. Skip
    // rather than write a nameless row.
    if (!actionName) return;
    if (!shouldRecordAudit(input.config, actionName)) return;

    const caller = ctx?.caller ?? "http";
    const actorEmail = ctx?.userEmail ?? null;
    const meta: AuditCallMeta = {
      status: input.status,
      caller,
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId ?? null,
    };

    const target = safeTarget(input.config, input.args, input.result, meta);
    const summary = safeSummary(input.config, input.args, input.result, meta);

    const recordInputs = input.config?.recordInputs !== false;
    const inputJson = recordInputs ? redactArgsToJson(input.args) : null;

    const hasExplicitTargetVisibility = target?.visibility !== undefined;
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      action: actionName,
      caller,
      actorKind: deriveActorKind(caller, actorEmail),
      actorEmail,
      orgId: ctx?.orgId ?? null,
      threadId: ctx?.threadId ?? null,
      turnId: ctx?.turnId ?? null,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      status: input.status,
      summary,
      input: inputJson,
      errorCode: input.status === "error" ? errorCode(input.error) : null,
      // Scope reads to the resource owner when the action declares one,
      // otherwise to the actor (the common self-mutation case).
      ownerEmail: target?.ownerEmail ?? actorEmail,
      visibility: target?.visibility ?? "private",
    };
    const lineage = getIntegrationRequestContext()?.lineage;
    const integration = getIntegrationRequestContext();
    if (integration) {
      if (
        ctx?.orgId &&
        event.visibility === "private" &&
        !hasExplicitTargetVisibility
      ) {
        event.visibility = "org";
      }
      event.runId = lineage?.runId ?? null;
      event.taskId = integration.taskId;
      event.parentTaskId = lineage?.parentTaskId ?? null;
      event.sourceKind = lineage?.source?.kind ?? null;
      event.sourcePlatform = lineage?.source?.platform ?? null;
      event.sourceId = lineage?.source?.id ?? null;
      event.sourceUrl = lineage?.source?.url ?? null;
      event.networkProtocol = lineage?.network?.protocol ?? null;
      event.networkId = lineage?.network?.id ?? null;
      event.networkPeer = lineage?.network?.peer ?? null;
      if (!event.networkProtocol && actionName === "provider-api-request") {
        event.networkProtocol = "provider-api";
        event.networkId = target?.id ?? "provider-api-request";
      }
      if (!event.networkProtocol && actionName === "call-agent") {
        event.networkProtocol = "a2a";
        event.networkId = target?.id ?? "call-agent";
      }
    }
    // org_id used for scoping defaults to the target's, else the actor's org.
    if (target?.orgId !== undefined) event.orgId = target.orgId;

    await insertAuditEvent(event);
  } catch {
    // Best-effort — auditing must never break the audited action.
  }
}
