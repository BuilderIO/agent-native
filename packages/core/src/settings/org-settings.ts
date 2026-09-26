import {
  getSetting,
  mutateSetting,
  putSetting,
  deleteSetting,
  deleteSettingsByPrefix,
  listSettingsByPrefix,
  type StoreWriteOptions,
  type StoreReadOptions,
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

export async function putOrgSetting(
  orgId: string,
  key: string,
  value: Record<string, unknown>,
  options?: StoreWriteOptions,
): Promise<void> {
  return putSetting(orgKey(orgId, key), value, options);
}

export async function mutateOrgSetting(
  orgId: string,
  key: string,
  updater: (
    current: Record<string, unknown> | null,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  options?: StoreWriteOptions,
): Promise<Record<string, unknown>> {
  return mutateSetting(orgKey(orgId, key), updater, options);
}

export async function deleteOrgSetting(
  orgId: string,
  key: string,
  options?: StoreWriteOptions,
): Promise<boolean> {
  return deleteSetting(orgKey(orgId, key), options);
}

export async function deleteAllOrgSettings(
  orgId: string,
  options?: StoreWriteOptions,
): Promise<number> {
  return deleteSettingsByPrefix(`o:${orgId}:`, options);
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
