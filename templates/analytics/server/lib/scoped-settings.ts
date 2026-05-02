import type { H3Event } from "h3";
import { getOrgContext } from "@agent-native/core/org";
import { DEV_MODE_USER_EMAIL } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  deleteOrgSetting,
  deleteSetting,
  deleteUserSetting,
  getAllSettings,
  getOrgSetting,
  getSetting,
  getUserSetting,
  listOrgSettings,
  putOrgSetting,
  putSetting,
  putUserSetting,
} from "@agent-native/core/settings";

export interface SettingsScope {
  email: string;
  orgId: string | null;
}

const LOCAL_EMAIL = DEV_MODE_USER_EMAIL;

function userPrefix(email: string) {
  return `u:${email}:`;
}

function isGlobalAppKey(key: string, prefix: string): boolean {
  return (
    key.startsWith(prefix) && !key.startsWith("u:") && !key.startsWith("o:")
  );
}

async function listUserSettings(
  email: string,
  prefix: string,
): Promise<Record<string, Record<string, unknown>>> {
  const all = await getAllSettings();
  const scopedPrefix = `${userPrefix(email)}${prefix}`;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(scopedPrefix)) continue;
    out[key.slice(userPrefix(email).length)] = value;
  }
  return out;
}

export async function resolveSettingsScope(
  event: H3Event,
): Promise<SettingsScope> {
  const ctx = await getOrgContext(event);
  if (ctx.email) {
    return { email: ctx.email, orgId: ctx.orgId };
  }
  const requestEmail = getRequestUserEmail();
  if (requestEmail) {
    return { email: requestEmail, orgId: getRequestOrgId() ?? null };
  }
  return { email: ctx.email, orgId: ctx.orgId };
}

export async function getScopedSettingRecord(
  scope: SettingsScope,
  key: string,
): Promise<Record<string, unknown> | null> {
  if (scope.orgId) {
    const orgValue = await getOrgSetting(scope.orgId, key);
    if (orgValue) return orgValue;
  }
  if (scope.email && scope.email !== LOCAL_EMAIL) {
    const userValue = await getUserSetting(scope.email, key);
    if (userValue) return userValue;
  }
  if (scope.email === LOCAL_EMAIL) {
    return getSetting(key);
  }
  return null;
}

export async function putScopedSettingRecord(
  scope: SettingsScope,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  if (scope.orgId) {
    await putOrgSetting(scope.orgId, key, value);
    return;
  }
  if (scope.email && scope.email !== LOCAL_EMAIL) {
    await putUserSetting(scope.email, key, value);
    return;
  }
  await putSetting(key, value);
}

export async function deleteScopedSettingRecord(
  scope: SettingsScope,
  key: string,
): Promise<void> {
  if (scope.orgId) {
    await deleteOrgSetting(scope.orgId, key);
    return;
  }
  if (scope.email && scope.email !== LOCAL_EMAIL) {
    await deleteUserSetting(scope.email, key);
    return;
  }
  await deleteSetting(key);
}

export async function listScopedSettingRecords(
  scope: SettingsScope,
  prefix: string,
): Promise<Record<string, Record<string, unknown>>> {
  const all = await getAllSettings();
  const byKey: Record<string, Record<string, unknown>> = {};

  if (scope.email === LOCAL_EMAIL) {
    for (const [key, value] of Object.entries(all)) {
      if (!isGlobalAppKey(key, prefix)) continue;
      byKey[key] = value;
    }
  }

  if (scope.email && scope.email !== LOCAL_EMAIL) {
    Object.assign(byKey, await listUserSettings(scope.email, prefix));
  }

  if (scope.orgId) {
    Object.assign(byKey, await listOrgSettings(scope.orgId, prefix));
  }

  return byKey;
}

export async function migrateGlobalSettingsPrefixesToUser(
  scope: SettingsScope,
  prefixes: string[],
): Promise<{ migrated: number; keys: string[] }> {
  if (!scope.email || scope.email === LOCAL_EMAIL) {
    return { migrated: 0, keys: [] };
  }

  const all = await getAllSettings();
  const keys = Object.keys(all).filter((key) =>
    prefixes.some((prefix) => isGlobalAppKey(key, prefix)),
  );

  const migrated: string[] = [];
  for (const key of keys) {
    const existing = await getUserSetting(scope.email, key);
    if (!existing) {
      await putUserSetting(scope.email, key, all[key]);
    }
    await deleteSetting(key);
    migrated.push(key);
  }

  return { migrated: migrated.length, keys: migrated };
}
