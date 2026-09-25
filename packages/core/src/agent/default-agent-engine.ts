/**
 * The default model (`agent-engine` setting): which engine and model a chat
 * uses when neither the app nor the chat picks one.
 *
 * It belongs to the organization, and only owners and admins change it. A
 * signed-in user with no organization keeps their own. Every reader and writer
 * goes through this module so the scope rules live in one place.
 */

import type { ActionCaller } from "../action.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { getOrgSetting, putOrgSetting } from "../settings/org-settings.js";
import { getSetting } from "../settings/store.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";
import { canUpdateAgentAppModelDefaultSettings } from "./app-model-defaults.js";

export const DEFAULT_AGENT_ENGINE_SETTING_KEY = "agent-engine";

/** Audit target type for default-model changes and refused attempts. */
export const DEFAULT_AGENT_ENGINE_AUDIT_TARGET_TYPE = "agent-default-model";

export type DefaultAgentEngineScope = "org" | "user";

/**
 * Where the effective default came from. `legacy` is the deployment-wide row
 * every organization shared before defaults were scoped; `none` means nothing
 * is stored and resolution falls through to credential detection.
 */
export type DefaultAgentEngineSource =
  | DefaultAgentEngineScope
  | "legacy"
  | "none";

export interface DefaultAgentEngineContext {
  userEmail?: string | null;
  orgId?: string | null;
}

export interface DefaultAgentEngineRead {
  /** The stored `{ engine, model }` row, or null when no default applies. */
  value: Record<string, unknown> | null;
  source: DefaultAgentEngineSource;
}

export type DefaultAgentEngineAuthority =
  | { allowed: true; scope: "org"; orgId: string; userEmail: string }
  | { allowed: true; scope: "user"; userEmail: string }
  | {
      allowed: false;
      reason: "unauthenticated" | "not-admin";
      message: string;
    };

export interface DefaultAgentEngineChangeMeta {
  /** Action or route name recorded on the audit event. */
  actionName: string;
  caller?: ActionCaller;
  threadId?: string;
  turnId?: string;
  runId?: string;
}

export interface DefaultAgentEngineSelection {
  engine: string;
  model: string;
}

function requestContext(): DefaultAgentEngineContext {
  return { userEmail: getRequestUserEmail(), orgId: getRequestOrgId() };
}

function normalizedContext(ctx: DefaultAgentEngineContext): {
  userEmail: string | undefined;
  orgId: string | undefined;
} {
  return {
    userEmail: ctx.userEmail?.trim() || undefined,
    orgId: ctx.orgId?.trim() || undefined,
  };
}

function hasEngine(value: Record<string, unknown>): boolean {
  return typeof value.engine === "string" && value.engine.trim().length > 0;
}

/**
 * Read the default that applies to `ctx` (the current request when omitted):
 * the organization's row, else a no-org user's own row, else the legacy
 * deployment-wide row.
 *
 * A scoped row with no engine is an explicit "cleared" marker. It answers for
 * that scope instead of falling through to the legacy row, so clearing the
 * default actually clears it for an organization that inherited a legacy one.
 */
export async function readDefaultAgentEngineSettingDetailed(
  ctx: DefaultAgentEngineContext = requestContext(),
): Promise<DefaultAgentEngineRead> {
  const { userEmail, orgId } = normalizedContext(ctx);
  if (orgId) {
    const scoped = await getOrgSetting(orgId, DEFAULT_AGENT_ENGINE_SETTING_KEY);
    if (scoped) {
      return { value: hasEngine(scoped) ? scoped : null, source: "org" };
    }
  } else if (userEmail) {
    const scoped = await getUserSetting(
      userEmail,
      DEFAULT_AGENT_ENGINE_SETTING_KEY,
    );
    if (scoped) {
      return { value: hasEngine(scoped) ? scoped : null, source: "user" };
    }
  }

  // Legacy fallback for one release, so deployments that saved a default
  // before it was org-scoped keep it until each org saves its own. Nothing
  // writes this row any more; remove this read after that release.
  const legacy = await getSetting(DEFAULT_AGENT_ENGINE_SETTING_KEY);
  return legacy
    ? { value: legacy, source: "legacy" }
    : { value: null, source: "none" };
}

/** {@link readDefaultAgentEngineSettingDetailed}, value only. */
export async function readDefaultAgentEngineSetting(
  ctx?: DefaultAgentEngineContext,
): Promise<Record<string, unknown> | null> {
  return (await readDefaultAgentEngineSettingDetailed(ctx)).value;
}

/**
 * Who may change the default for `ctx`: owners and admins change their
 * organization's; a signed-in user with no organization changes their own.
 */
export async function resolveDefaultAgentEngineAuthority(
  ctx: DefaultAgentEngineContext = requestContext(),
): Promise<DefaultAgentEngineAuthority> {
  const { userEmail, orgId } = normalizedContext(ctx);
  if (!userEmail) {
    return {
      allowed: false,
      reason: "unauthenticated",
      message: "Sign in to change the default model.",
    };
  }
  if (!orgId) return { allowed: true, scope: "user", userEmail };
  if (await canUpdateAgentAppModelDefaultSettings(userEmail, orgId)) {
    return { allowed: true, scope: "org", orgId, userEmail };
  }
  return {
    allowed: false,
    reason: "not-admin",
    message:
      "Only organization owners and admins can change the default model.",
  };
}

async function writeScopedRow(
  authority: Extract<DefaultAgentEngineAuthority, { allowed: true }>,
  value: Record<string, unknown>,
): Promise<void> {
  if (authority.scope === "org") {
    await putOrgSetting(
      authority.orgId,
      DEFAULT_AGENT_ENGINE_SETTING_KEY,
      value,
    );
    return;
  }
  await putUserSetting(
    authority.userEmail,
    DEFAULT_AGENT_ENGINE_SETTING_KEY,
    value,
  );
}

/**
 * Save the default for the authority's scope. Validate the engine first; this
 * only stores it and records the change.
 */
export async function writeDefaultAgentEngineSelection(
  authority: Extract<DefaultAgentEngineAuthority, { allowed: true }>,
  selection: DefaultAgentEngineSelection,
  meta: DefaultAgentEngineChangeMeta,
): Promise<void> {
  await writeScopedRow(authority, {
    engine: selection.engine,
    model: selection.model,
    updatedAt: Date.now(),
    updatedBy: authority.userEmail,
  });
  await recordDefaultAgentEngineAudit({
    meta,
    userEmail: authority.userEmail,
    orgId: authority.scope === "org" ? authority.orgId : null,
    status: "success",
    operation: "set",
    selection,
  });
}

/**
 * Clear the default for the authority's scope. Writes a cleared marker rather
 * than deleting the row; see {@link readDefaultAgentEngineSettingDetailed}.
 */
export async function clearDefaultAgentEngineSelection(
  authority: Extract<DefaultAgentEngineAuthority, { allowed: true }>,
  meta: DefaultAgentEngineChangeMeta,
): Promise<void> {
  await writeScopedRow(authority, {
    cleared: true,
    updatedAt: Date.now(),
    updatedBy: authority.userEmail,
  });
  await recordDefaultAgentEngineAudit({
    meta,
    userEmail: authority.userEmail,
    orgId: authority.scope === "org" ? authority.orgId : null,
    status: "success",
    operation: "clear",
  });
}

/** Record a refused change so owners and admins can see who tried. */
export async function recordDefaultAgentEngineRefusal(
  ctx: DefaultAgentEngineContext,
  authority: Extract<DefaultAgentEngineAuthority, { allowed: false }>,
  operation: "set" | "clear",
  meta: DefaultAgentEngineChangeMeta,
  selection?: { engine: string; model?: string },
): Promise<void> {
  const { userEmail, orgId } = normalizedContext(ctx);
  await recordDefaultAgentEngineAudit({
    meta,
    userEmail: userEmail ?? null,
    orgId: orgId ?? null,
    status: "denied",
    operation,
    selection,
    reason: authority.reason,
  });
}

async function recordDefaultAgentEngineAudit(input: {
  meta: DefaultAgentEngineChangeMeta;
  userEmail: string | null;
  orgId: string | null;
  status: "success" | "denied";
  operation: "set" | "clear";
  selection?: { engine: string; model?: string };
  reason?: string;
}): Promise<void> {
  const { meta, userEmail, orgId, status, operation, selection } = input;
  const summary =
    status === "denied"
      ? operation === "set"
        ? "Refused a default model change"
        : "Refused clearing the default model"
      : operation === "set"
        ? `Default model set to ${selection?.model} (${selection?.engine})`
        : "Default model cleared";
  const { recordActionAudit } = await import("../audit/record.js");
  await recordActionAudit({
    config: {
      enabled: true,
      target: () => ({
        type: DEFAULT_AGENT_ENGINE_AUDIT_TARGET_TYPE,
        id: orgId ?? userEmail ?? DEFAULT_AGENT_ENGINE_SETTING_KEY,
        orgId,
        visibility: orgId ? "org" : "private",
      }),
      summary: () => summary,
    },
    args: {
      operation,
      ...(selection ?? {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    ctx: {
      actionName: meta.actionName,
      caller: meta.caller,
      userEmail: userEmail ?? undefined,
      orgId,
      threadId: meta.threadId,
      turnId: meta.turnId,
      runId: meta.runId,
    },
    status,
  });
}
