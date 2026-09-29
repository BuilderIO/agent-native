import { getDbExec } from "@agent-native/core/db";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";

export const MCP_APP_ACCESS_SETTINGS_KEY = "dispatch-mcp-app-access";

export type DispatchMcpAppAccessMode = "all-apps" | "selected-apps";

export interface DispatchMcpAppAccessSettings {
  mode: DispatchMcpAppAccessMode;
  selectedAppIds: string[];
  updatedAt?: string;
  updatedBy?: string;
}

class OrgAdminSettingError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "OrgAdminSettingError";
    this.statusCode = statusCode;
  }
}

export interface AdminSettingScope {
  kind: "org" | "user";
  id: string;
  actor: string;
}

function uniqueAppIds(values: unknown): string[] {
  const input = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(
      input
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function normalizeMcpAppAccessSettings(
  raw: unknown,
): DispatchMcpAppAccessSettings {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const mode = record.mode === "selected-apps" ? "selected-apps" : "all-apps";
  return {
    mode,
    selectedAppIds: uniqueAppIds(record.selectedAppIds),
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    updatedBy:
      typeof record.updatedBy === "string" ? record.updatedBy : undefined,
  };
}

/** Org-scoped when the request has an org, otherwise scoped to the user. */
export function currentAdminSettingScope(): AdminSettingScope {
  const actor = getRequestUserEmail();
  if (!actor) throw new Error("no authenticated user");
  const orgId = getRequestOrgId();
  if (orgId) return { kind: "org", id: orgId, actor };
  return { kind: "user", id: actor, actor };
}

export async function canManageAdminSetting(
  scope: AdminSettingScope,
): Promise<boolean> {
  if (scope.kind === "user") return true;

  let role: unknown = null;
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT role FROM org_members
            WHERE org_id = ? AND LOWER(email) = ?
              AND federation_removal_pending_at IS NULL
            LIMIT 1`,
      args: [scope.id, scope.actor.toLowerCase()],
    });
    role = rows[0]?.role;
  } catch {
    // Fail closed when org membership cannot be verified.
  }
  return role === "owner" || role === "admin";
}

export async function assertCanManageAdminSetting(
  scope: AdminSettingScope,
  message: string,
): Promise<void> {
  if (!(await canManageAdminSetting(scope))) {
    throw new OrgAdminSettingError(message, 403);
  }
}

export async function getDispatchMcpAppAccessSettings(): Promise<DispatchMcpAppAccessSettings> {
  const scope = currentAdminSettingScope();
  const raw =
    scope.kind === "org"
      ? await getOrgSetting(scope.id, MCP_APP_ACCESS_SETTINGS_KEY)
      : await getUserSetting(scope.id, MCP_APP_ACCESS_SETTINGS_KEY);
  return normalizeMcpAppAccessSettings(raw);
}

export async function setDispatchMcpAppAccessSettings(input: {
  mode: DispatchMcpAppAccessMode;
  selectedAppIds?: string[];
}): Promise<DispatchMcpAppAccessSettings> {
  const scope = currentAdminSettingScope();
  await assertCanManageAdminSetting(
    scope,
    "Only organization owners and admins can change Dispatch MCP app access.",
  );
  const next: DispatchMcpAppAccessSettings = {
    mode: input.mode,
    selectedAppIds: uniqueAppIds(input.selectedAppIds),
    updatedAt: new Date().toISOString(),
    updatedBy: scope.actor,
  };
  const value = next as unknown as Record<string, unknown>;
  if (scope.kind === "org") {
    await putOrgSetting(scope.id, MCP_APP_ACCESS_SETTINGS_KEY, value);
  } else {
    await putUserSetting(scope.id, MCP_APP_ACCESS_SETTINGS_KEY, value);
  }
  return next;
}

export function isAppAllowedByMcpAccess(
  appId: string,
  settings: DispatchMcpAppAccessSettings,
): boolean {
  const normalized = appId.trim().toLowerCase();
  if (!normalized) return false;
  if (settings.mode === "all-apps") return true;
  return settings.selectedAppIds.includes(normalized);
}
