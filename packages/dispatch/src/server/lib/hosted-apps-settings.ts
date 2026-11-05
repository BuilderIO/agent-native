import { ActionContractError } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  getBuiltinAgents,
  loadWorkspaceAppsManifest,
  normalizeAgentId,
  type DiscoveredAgent,
} from "@agent-native/core/server/agent-discovery";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";

import { HOSTED_APPS_SETTINGS_INVALID_ERROR_CODE } from "../../shared/hosted-apps-settings.js";

export const HOSTED_APPS_SETTINGS_KEY = "dispatch-hosted-apps-settings";

export interface HostedAppsSettings {
  showHostedApps: boolean;
}

// A contract error, so its code reaches Settings, which offers the save that
// repairs it; a bare error would arrive as an anonymous 500.
export class InvalidHostedAppsSettingsError extends ActionContractError {
  constructor() {
    super(
      `Stored ${HOSTED_APPS_SETTINGS_KEY} is not { showHostedApps: boolean }. Save the Agent-Native.com hosted apps setting again to repair it.`,
      { errorCode: HOSTED_APPS_SETTINGS_INVALID_ERROR_CODE, statusCode: 409 },
    );
    this.name = "InvalidHostedAppsSettingsError";
  }
}

/**
 * Built-in catalog apps this workspace offers. A mounted workspace app with a
 * built-in's id is a workspace app; the built-in config never applies to it.
 */
export async function listHostedApps(): Promise<DiscoveredAgent[]> {
  const workspaceApps = await loadWorkspaceAppsManifest();
  const workspaceIds = new Set(
    (workspaceApps ?? []).map((app) => normalizeAgentId(app.id)),
  );
  return getBuiltinAgents("dispatch").filter(
    (agent) => !workspaceIds.has(agent.id),
  );
}

function hostedAppsSettingsScope() {
  const orgId = getRequestOrgId();
  if (orgId) return { scope: "org" as const, scopeId: orgId };
  const email = getRequestUserEmail();
  return email ? { scope: "user" as const, scopeId: email } : null;
}

/**
 * The stored setting. An unreadable value is `invalid` and hides hosted apps,
 * so it cannot fail the app lists or agent context; Settings reports it.
 */
export async function readHostedAppsSettings(): Promise<
  HostedAppsSettings & { invalid: boolean }
> {
  const scope = hostedAppsSettingsScope();
  // No org and no user means there is nowhere the setting could be stored.
  if (!scope) return { showHostedApps: true, invalid: false };
  const raw =
    scope.scope === "org"
      ? await getOrgSetting(scope.scopeId, HOSTED_APPS_SETTINGS_KEY)
      : await getUserSetting(scope.scopeId, HOSTED_APPS_SETTINGS_KEY);
  if (raw === null) return { showHostedApps: true, invalid: false };
  if (typeof raw.showHostedApps !== "boolean") {
    return { showHostedApps: false, invalid: true };
  }
  return { showHostedApps: raw.showHostedApps, invalid: false };
}

export async function setHostedAppsSettings(
  next: HostedAppsSettings,
): Promise<HostedAppsSettings> {
  const scope = hostedAppsSettingsScope();
  if (!scope) {
    throw Object.assign(
      new Error("Sign in to change the Agent-Native.com hosted apps setting."),
      { statusCode: 401 },
    );
  }
  const value = { showHostedApps: next.showHostedApps };
  if (scope.scope === "org") {
    await putOrgSetting(scope.scopeId, HOSTED_APPS_SETTINGS_KEY, value);
  } else {
    await putUserSetting(scope.scopeId, HOSTED_APPS_SETTINGS_KEY, value);
  }
  return value;
}

/** Hides hosted apps from Dispatch's lists and agent context when off. */
export async function hideHostedAppsWhenOff<T extends { id: string }>(
  agents: T[],
): Promise<T[]> {
  const { showHostedApps } = await readHostedAppsSettings();
  if (showHostedApps) return agents;
  const hostedIds = new Set((await listHostedApps()).map((app) => app.id));
  return agents.filter((agent) => !hostedIds.has(agent.id));
}
