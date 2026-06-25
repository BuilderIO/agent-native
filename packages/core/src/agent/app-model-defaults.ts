import { getDbExec } from "../db/client.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  deleteOrgSetting,
  deleteUserSetting,
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "../settings/index.js";

export const AGENT_APP_MODEL_DEFAULT_KEY_PREFIX = "agent-app-model-default";

export type AgentAppModelDefaultScope = "org" | "user" | "default";
export type AgentAppModelDefaultSource = "org" | "user" | "default";

export interface AgentAppModelDefaultSelection {
  engine: string;
  model: string;
  updatedAt?: number;
  updatedBy?: string;
}

export interface AgentAppModelDefaultSettings {
  appId: string;
  engine: string | null;
  model: string | null;
  scope: AgentAppModelDefaultScope;
  source: AgentAppModelDefaultSource;
}

export function normalizeAgentAppModelDefaultAppId(
  appId: string | null | undefined,
): string | null {
  const normalized = appId?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (!/^[a-z][a-z0-9-]*$/.test(normalized)) return null;
  return normalized;
}

export function agentAppModelDefaultSettingsKey(appId: string): string {
  return `${AGENT_APP_MODEL_DEFAULT_KEY_PREFIX}:${appId}`;
}

function parseSelection(
  stored: Record<string, unknown> | null,
): AgentAppModelDefaultSelection | null {
  if (!stored) return null;
  const engine = typeof stored.engine === "string" ? stored.engine.trim() : "";
  const model = typeof stored.model === "string" ? stored.model.trim() : "";
  if (!engine || !model) return null;
  return {
    engine,
    model,
    updatedAt:
      typeof stored.updatedAt === "number" && Number.isFinite(stored.updatedAt)
        ? stored.updatedAt
        : undefined,
    updatedBy:
      typeof stored.updatedBy === "string" ? stored.updatedBy : undefined,
  };
}

function emptySettings(
  appId: string,
  scope: AgentAppModelDefaultScope,
): AgentAppModelDefaultSettings {
  return {
    appId,
    engine: null,
    model: null,
    scope,
    source: "default",
  };
}

export async function readAgentAppModelDefaultSettings(
  ctx: { userEmail?: string | null; orgId?: string | null },
  appIdInput: string | null | undefined,
): Promise<AgentAppModelDefaultSettings> {
  const appId = normalizeAgentAppModelDefaultAppId(appIdInput);
  if (!appId) {
    throw new Error("A valid appId is required.");
  }

  const key = agentAppModelDefaultSettingsKey(appId);
  if (ctx.orgId) {
    const stored = parseSelection(await getOrgSetting(ctx.orgId, key));
    return stored
      ? { appId, ...stored, scope: "org", source: "org" }
      : emptySettings(appId, "org");
  }

  if (ctx.userEmail) {
    const stored = parseSelection(await getUserSetting(ctx.userEmail, key));
    return stored
      ? { appId, ...stored, scope: "user", source: "user" }
      : emptySettings(appId, "user");
  }

  return emptySettings(appId, "default");
}

export async function writeAgentAppModelDefaultSettings(
  ctx: { userEmail?: string | null; orgId?: string | null },
  appIdInput: string | null | undefined,
  selection: { engine: string; model: string; updatedBy?: string | null },
): Promise<AgentAppModelDefaultSettings> {
  const appId = normalizeAgentAppModelDefaultAppId(appIdInput);
  if (!appId) throw new Error("A valid appId is required.");

  const engine = selection.engine.trim();
  const model = selection.model.trim();
  if (!engine) throw new Error("engine is required.");
  if (!model) throw new Error("model is required.");

  const value: Record<string, unknown> = {
    engine,
    model,
    updatedAt: Date.now(),
  };
  if (selection.updatedBy) value.updatedBy = selection.updatedBy;

  const key = agentAppModelDefaultSettingsKey(appId);
  if (ctx.orgId) {
    await putOrgSetting(ctx.orgId, key, value);
    return readAgentAppModelDefaultSettings(ctx, appId);
  }

  if (!ctx.userEmail) {
    throw new Error("Authentication required to update model defaults.");
  }

  await putUserSetting(ctx.userEmail, key, value);
  return readAgentAppModelDefaultSettings(ctx, appId);
}

export async function resetAgentAppModelDefaultSettings(
  ctx: { userEmail?: string | null; orgId?: string | null },
  appIdInput: string | null | undefined,
): Promise<AgentAppModelDefaultSettings> {
  const appId = normalizeAgentAppModelDefaultAppId(appIdInput);
  if (!appId) throw new Error("A valid appId is required.");

  const key = agentAppModelDefaultSettingsKey(appId);
  if (ctx.orgId) {
    await deleteOrgSetting(ctx.orgId, key);
    return readAgentAppModelDefaultSettings(ctx, appId);
  }

  if (!ctx.userEmail) {
    throw new Error("Authentication required to reset model defaults.");
  }

  await deleteUserSetting(ctx.userEmail, key);
  return readAgentAppModelDefaultSettings(ctx, appId);
}

export async function canUpdateAgentAppModelDefaultSettings(
  userEmail: string | null | undefined,
  orgId: string | null | undefined,
): Promise<boolean> {
  if (!userEmail) return false;
  if (!orgId) return true;

  try {
    const exec = getDbExec();
    const { rows } = await exec.execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, userEmail.toLowerCase()],
    });
    const role = String((rows[0] as any)?.role ?? "");
    return role === "owner" || role === "admin";
  } catch {
    return false;
  }
}

export async function getAgentAppModelDefaultForCurrentRequest(
  appIdInput: string | null | undefined,
): Promise<AgentAppModelDefaultSelection | null> {
  const appId = normalizeAgentAppModelDefaultAppId(appIdInput);
  if (!appId) return null;

  const userEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();

  const settings = await readAgentAppModelDefaultSettings(
    { userEmail, orgId },
    appId,
  ).catch(() => null);

  if (!settings?.engine || !settings.model) return null;
  return {
    engine: settings.engine,
    model: settings.model,
  };
}
