import {
  getBuiltinAgents,
  readBuiltinAgentsConfig,
  readBuiltinAgentsEnabledSettings,
  resolveEnabledBuiltinAgentIds,
  writeBuiltinAgentsEnabledSettings,
  type BuiltinAgentsMode,
} from "@agent-native/core/server/agent-discovery";

import {
  assertCanManageAdminSetting,
  canManageAdminSetting,
  currentAdminSettingScope,
} from "./mcp-access-store.js";

const DISPATCH_APP_ID = "dispatch";

export interface BuiltinAppSummary {
  id: string;
  name: string;
  description: string;
  color: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface BuiltinAppsListing {
  mode: BuiltinAgentsMode;
  canManage: boolean;
  apps: BuiltinAppSummary[];
  updatedAt?: string;
  updatedBy?: string;
}

export async function listBuiltinApps(): Promise<BuiltinAppsListing> {
  const scope = currentAdminSettingScope();
  const config = readBuiltinAgentsConfig();
  const [settings, canManage] = await Promise.all([
    readBuiltinAgentsEnabledSettings(scope),
    canManageAdminSetting(scope),
  ]);
  const enabled = new Set(resolveEnabledBuiltinAgentIds(config, settings));
  const defaults = new Set(config.defaultEnabled);
  return {
    mode: config.mode,
    canManage,
    apps: getBuiltinAgents(DISPATCH_APP_ID).map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      color: app.color,
      enabled: enabled.has(app.id),
      isDefault: defaults.has(app.id),
    })),
    ...(settings?.updatedAt ? { updatedAt: settings.updatedAt } : {}),
    ...(settings?.updatedBy ? { updatedBy: settings.updatedBy } : {}),
  };
}

export async function setBuiltinAppsEnabled(
  enabledIds: string[],
): Promise<{ enabledIds: string[]; offeredCount: number }> {
  const scope = currentAdminSettingScope();
  await assertCanManageAdminSetting(
    scope,
    "Only organization owners and admins can change built-in apps.",
  );
  const config = readBuiltinAgentsConfig();
  // Dispatch never lists itself, so keep its current state instead of letting
  // "Disable all" silently drop it for sibling apps sharing this org.
  const keepDispatch =
    config.include.includes(DISPATCH_APP_ID) &&
    resolveEnabledBuiltinAgentIds(
      config,
      await readBuiltinAgentsEnabledSettings(scope),
    ).includes(DISPATCH_APP_ID);
  const saved = await writeBuiltinAgentsEnabledSettings({
    scope,
    enabledIds: keepDispatch ? [...enabledIds, DISPATCH_APP_ID] : enabledIds,
    actor: scope.actor,
    config,
  });
  return { enabledIds: saved.enabledIds, offeredCount: config.include.length };
}
