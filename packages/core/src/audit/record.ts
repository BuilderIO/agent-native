import { getAppConfig } from "../app-config/index.js";
import { captureError } from "../server/capture-error.js";
import { getIntegrationRequestContext } from "../server/request-context.js";
import { redact, redactErrorStack } from "../tracking/redaction.js";
import {
  assertAuditAttribution,
  type AuditAttribution,
} from "./attribution.js";
import { committedActionAuditOutcome } from "./committed-outcome.js";
import {
  deriveActorKind,
  isAuditDisabled,
  shouldRecordAudit,
} from "./config.js";
import { redactArgsToJson } from "./redact.js";
import { insertAuditEvent } from "./store.js";
import type {
  ActionAuditConfig,
  AuditApproval,
  AuditCallMeta,
  AuditEvent,
  AuditStatus,
  AuditTarget,
} from "./types.js";

/** The action and the principal it ran as. */
export interface AuditSubject {
  actionName?: string;
  userEmail?: string;
  orgId?: string | null;
}

export interface RecordActionAuditInput {
  config: ActionAuditConfig | undefined;
  args: unknown;
  ctx: AuditSubject | undefined;
  /** From `auditAttribution` or `routeAuditAttribution`. */
  attribution: AuditAttribution;
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

function approvalEvidence(attribution: AuditAttribution): AuditApproval | null {
  if (attribution.approval) return attribution.approval;
  if (attribution.approvedToolCallKey) return "agent-chat";
  if (attribution.mcpClientAccepted === true) return "mcp-client-accepted";
  return null;
}

// Self-reported, so bounded and printable: a client can send any string,
// including a NUL that PostgreSQL refuses to store.
function reportedLabel(value: string | undefined): string | null {
  return (
    value
      ?.trim()
      .replace(/\p{Cc}/gu, "\uFFFD")
      .slice(0, 200) || null
  );
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
  // Outside the try: a caller with no attribution is a bug to surface, not a
  // write failure to swallow along with its row.
  const attribution = input.attribution;
  assertAuditAttribution(attribution, "recordActionAudit");
  try {
    if (isAuditDisabled()) return;
    const ctx = input.ctx;
    const actionName = ctx?.actionName;
    if (!actionName) return;
    if (!shouldRecordAudit(input.config, actionName)) return;

    const caller = attribution.caller;
    const actorEmail = ctx?.userEmail ?? null;
    const committed =
      input.status === "error"
        ? committedActionAuditOutcome(input.error)
        : undefined;
    // A refused call is an attempt worth seeing, not a failure.
    const status: AuditStatus = committed
      ? "success"
      : input.status === "error" && isRefusal(input.error)
        ? "denied"
        : input.status;
    if (isRejectedProbe(input.args, status, input.error)) return;
    const meta: AuditCallMeta = {
      status,
      caller,
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId ?? null,
    };

    const result = committed ? committed.result : input.result;
    const target = safeTarget(input.config, input.args, result, meta);
    const summary = safeSummary(input.config, input.args, result, meta);

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
      actorKind: deriveActorKind(caller, actorEmail, ctx?.orgId),
      actorEmail,
      orgId: ctx?.orgId ?? null,
      threadId: attribution.threadId ?? null,
      turnId: attribution.turnId ?? null,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      status,
      summary,
      input: inputJson,
      errorCode: input.error ? errorCode(input.error) : null,
      ownerEmail: target?.ownerEmail ?? actorEmail,
      visibility: target?.visibility ?? "private",
      runId: attribution.runId ?? lineage?.runId ?? null,
      networkProtocol: attribution.networkProtocol ?? null,
      networkId: attribution.networkId ?? null,
      networkPeer: attribution.networkPeer ?? null,
      app: auditAppKey(),
      reportedClientName: reportedLabel(attribution.mcpClient?.name),
      reportedClientVersion: reportedLabel(attribution.mcpClient?.version),
      oauthClientId: attribution.mcpClient?.oauthClientId ?? null,
      approval: approvalEvidence(attribution),
    };
    if (integration) {
      if (
        ctx?.orgId &&
        event.visibility === "private" &&
        !hasExplicitTargetVisibility
      ) {
        event.visibility = "org";
      }
      event.runId = attribution.runId ?? lineage?.runId ?? null;
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
  } catch (error) {
    // Never rethrown: auditing must not break the audited action. Reported,
    // because nothing else shows that the call went unrecorded.
    const action = input.ctx?.actionName ?? "unknown";
    console.error(`[audit] Could not record '${action}':`, {
      action,
      error: redactErrorStack(error) ?? redact(String(error)),
    });
    captureError(error, {
      tags: { component: "audit", operation: "record-action-audit", action },
    });
  }
}
