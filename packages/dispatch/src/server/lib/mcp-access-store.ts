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

interface AccessScope {
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

function currentAccessScope(): AccessScope {
  const actor = getRequestUserEmail();
  if (!actor) throw new Error("no authenticated user");
  const orgId = getRequestOrgId();
  if (orgId) return { kind: "org", id: orgId, actor };
  return { kind: "user", id: actor, actor };
}

export async function getDispatchMcpAppAccessSettings(): Promise<DispatchMcpAppAccessSettings> {
  const scope = currentAccessScope();
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
  const scope = currentAccessScope();
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
