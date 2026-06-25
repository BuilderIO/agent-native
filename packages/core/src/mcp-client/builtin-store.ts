import {
  getOrgSetting,
  putOrgSetting,
  deleteOrgSetting,
} from "../settings/org-settings.js";
import {
  getUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "../settings/user-settings.js";
import {
  getBuiltinMcpCapability,
  normalizeBuiltinMcpCapabilityIds,
  type BuiltinMcpCapabilityId,
} from "./builtin-capabilities.js";
import type { RemoteMcpScope } from "./remote-store.js";

const SETTINGS_KEY = "mcp-builtin-capabilities";

export interface StoredBuiltinMcpCapabilities {
  enabledIds: BuiltinMcpCapabilityId[];
}

async function readSetting(
  scope: RemoteMcpScope,
  scopeId: string,
): Promise<Record<string, unknown> | null> {
  return scope === "user"
    ? getUserSetting(scopeId, SETTINGS_KEY)
    : getOrgSetting(scopeId, SETTINGS_KEY);
}

async function writeSetting(
  scope: RemoteMcpScope,
  scopeId: string,
  enabledIds: BuiltinMcpCapabilityId[],
): Promise<void> {
  if (enabledIds.length === 0) {
    if (scope === "user") {
      await deleteUserSetting(scopeId, SETTINGS_KEY);
    } else {
      await deleteOrgSetting(scopeId, SETTINGS_KEY);
    }
    return;
  }
  const value: StoredBuiltinMcpCapabilities & Record<string, unknown> = {
    enabledIds,
  };
  if (scope === "user") {
    await putUserSetting(scopeId, SETTINGS_KEY, value);
  } else {
    await putOrgSetting(scopeId, SETTINGS_KEY, value);
  }
}

export function builtinMcpCapabilitiesSettingsKey(): string {
  return SETTINGS_KEY;
}

export async function listEnabledBuiltinMcpCapabilities(
  scope: RemoteMcpScope,
  scopeId: string,
): Promise<BuiltinMcpCapabilityId[]> {
  const raw = await readSetting(scope, scopeId);
  if (!raw || !Array.isArray(raw.enabledIds)) return [];
  return normalizeBuiltinMcpCapabilityIds(raw.enabledIds.map(String));
}

export async function setEnabledBuiltinMcpCapabilities(
  scope: RemoteMcpScope,
  scopeId: string,
  ids: readonly string[],
): Promise<BuiltinMcpCapabilityId[]> {
  const enabledIds = normalizeBuiltinMcpCapabilityIds(ids);
  await writeSetting(scope, scopeId, enabledIds);
  return enabledIds;
}

export async function setBuiltinMcpCapabilityEnabled(
  scope: RemoteMcpScope,
  scopeId: string,
  id: string,
  enabled: boolean,
): Promise<BuiltinMcpCapabilityId[] | null> {
  const capability = getBuiltinMcpCapability(id);
  if (!capability) return null;
  const existing = await listEnabledBuiltinMcpCapabilities(scope, scopeId);
  const next = enabled
    ? normalizeBuiltinMcpCapabilityIds([...existing, capability.id])
    : existing.filter((existingId) => existingId !== capability.id);
  await writeSetting(scope, scopeId, next);
  return next;
}
