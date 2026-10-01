import { getAppConfig } from "../app-config/index.js";
import { getIntegrationRequestContext } from "../server/request-context.js";
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

export interface AuditRunContextLike {
  actionName?: string;
  caller?: string;
  userEmail?: string;
  orgId?: string | null;
  threadId?: string;
  runId?: string;
  turnId?: string;
  networkProtocol?: "a2a" | "mcp" | "provider-api";
  networkId?: string;
  networkPeer?: string;
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

/**
 * Reserved argument a health or capability probe sends as its only argument
 * (`{ "__probe__": true }`) to check that an action route is deployed and the
 * token is accepted. The call is expected to be rejected, so it is not a
 * failure worth a row; the PR recap workflow alone sends ~700 a day.
 */
export const AUDIT_PROBE_ARG = "__probe__";

// Exact shape, rejected before the action ran: a probe that executed (even one
// that then threw), or one carrying real arguments, is recorded like any call
// so the marker cannot hide a change. A default `z.object` strips the marker,
// so an action whose arguments are all optional really runs on a probe.
function isRejectedProbe(
  args: unknown,
  status: AuditStatus,
  error: unknown,
): boolean {
  if (status !== "error" || !isBadRequest(error)) return false;
  if (!args || typeof args !== "object") return false;
  const keys = Object.keys(args);
  return (
    !Array.isArray(args) &&
    keys.length === 1 &&
    (args as Record<string, unknown>)[AUDIT_PROBE_ARG] === true
  );
}

function isBadRequest(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    name?: unknown;
    message?: unknown;
    statusCode?: unknown;
    status?: unknown;
  };
  return (
    e.name === "ZodError" ||
    (e.statusCode ?? e.status) === 400 ||
    (typeof e.message === "string" &&
      e.message.startsWith("Invalid action parameters"))
  );
}

function isRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { statusCode?: unknown; status?: unknown };
  const status = e.statusCode ?? e.status;
  return status === 401 || status === 403;
}

// Same key as usage's `resolveUsageAppKey`, so the audit and usage app
// filters agree. Null, not a placeholder, when the app has no identity.
function auditAppKey(): string | null {
  const { app } = getAppConfig();
  return (app.id ?? app.name)?.trim() || null;
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

export async function recordActionAudit(
  input: RecordActionAuditInput,
): Promise<void> {
  try {
    if (isAuditDisabled()) return;
    const ctx = input.ctx;
    const actionName = ctx?.actionName;
    if (!actionName) return;
    if (!shouldRecordAudit(input.config, actionName)) return;

    const caller = ctx?.caller ?? "http";
    const actorEmail = ctx?.userEmail ?? null;
    // A refused call is an attempt worth seeing, not a failure.
    const status: AuditStatus =
      input.status === "error" && isRefusal(input.error)
        ? "denied"
        : input.status;
    if (isRejectedProbe(input.args, status, input.error)) return;
    const meta: AuditCallMeta = {
      status,
      caller,
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId ?? null,
    };

    const target = safeTarget(input.config, input.args, input.result, meta);
    const summary = safeSummary(input.config, input.args, input.result, meta);

    const recordInputs = input.config?.recordInputs !== false;
    const inputJson = recordInputs ? redactArgsToJson(input.args) : null;

    const hasExplicitTargetVisibility = target?.visibility !== undefined;
    const integration = getIntegrationRequestContext();
    const lineage = integration?.lineage;
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
      status,
      summary,
      input: inputJson,
      errorCode: input.error ? errorCode(input.error) : null,
      ownerEmail: target?.ownerEmail ?? actorEmail,
      visibility: target?.visibility ?? "private",
      runId: ctx?.runId ?? lineage?.runId ?? null,
      networkProtocol: ctx?.networkProtocol ?? null,
      networkId: ctx?.networkId ?? null,
      networkPeer: ctx?.networkPeer ?? null,
      app: auditAppKey(),
    };
    if (integration) {
      if (
        ctx?.orgId &&
        event.visibility === "private" &&
        !hasExplicitTargetVisibility
      ) {
        event.visibility = "org";
      }
      event.runId = ctx?.runId ?? lineage?.runId ?? null;
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
    if (target?.orgId !== undefined) event.orgId = target.orgId;

    await insertAuditEvent(event);
  } catch {
    // Best-effort — auditing must never break the audited action.
  }
}
