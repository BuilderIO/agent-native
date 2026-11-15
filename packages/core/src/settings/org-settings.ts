import {
  getSetting,
  getSettingEntry,
  mutateSetting,
  putSetting,
  deleteSetting,
  deleteSettingsByPrefix,
  listSettingsByPrefix,
  type SettingEntry,
  type StoreReadOptions,
  type OrgSettingWriteOptions,
  assertScopedSettingsOptions,
} from "./store.js";

function orgKey(orgId: string, key: string): string {
  return `o:${orgId}:${key}`;
}

const ORG_PREFIX_RE = /^o:([^:]+):(.+)$/;

export async function getOrgSetting(
  orgId: string,
  key: string,
  options?: StoreReadOptions,
): Promise<Record<string, unknown> | null> {
  return getSetting(orgKey(orgId, key), options);
}

export async function getOrgSettingEntry(
  orgId: string,
  key: string,
  options?: StoreReadOptions,
): Promise<SettingEntry> {
  return getSettingEntry(orgKey(orgId, key), options);
}

export async function putOrgSetting(
  orgId: string,
  key: string,
  value: Record<string, unknown>,
  options?: OrgSettingWriteOptions,
): Promise<void> {
  assertScopedSettingsOptions(options);
  return putSetting(orgKey(orgId, key), value, { ...options, orgId });
}

export async function mutateOrgSetting(
  orgId: string,
  key: string,
  updater: (
    current: Record<string, unknown> | null,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  options?: OrgSettingWriteOptions,
): Promise<Record<string, unknown>> {
  assertScopedSettingsOptions(options);
  return mutateSetting(orgKey(orgId, key), updater, { ...options, orgId });
}

export async function deleteOrgSetting(
  orgId: string,
  key: string,
  options?: OrgSettingWriteOptions,
): Promise<boolean> {
  assertScopedSettingsOptions(options);
  return deleteSetting(orgKey(orgId, key), { ...options, orgId });
}

export async function deleteAllOrgSettings(
  orgId: string,
  options?: OrgSettingWriteOptions,
): Promise<number> {
  assertScopedSettingsOptions(options);
  return deleteSettingsByPrefix(`o:${orgId}:`, { ...options, orgId });
}

export async function listOrgSettings(
  orgId: string,
  subPrefix?: string,
  options?: { limit?: number },
): Promise<Record<string, Record<string, unknown>>> {
  const scoped = await listSettingsByPrefix(
    `o:${orgId}:${subPrefix ?? ""}`,
    options,
  );
  const out: Record<string, Record<string, unknown>> = {};
  for (const { key: fullKey, value } of scoped) {
    const m = ORG_PREFIX_RE.exec(fullKey);
    if (!m || m[1] !== orgId) continue;
    const key = m[2];
    if (subPrefix && !key.startsWith(subPrefix)) continue;
    out[key] = value;
  }
  return out;
}
