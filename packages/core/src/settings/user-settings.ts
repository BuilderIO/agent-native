import {
  getSetting,
  getSettings,
  mutateSetting,
  putSetting,
  deleteSettingIfValue,
  type StoreWriteOptions,
} from "./store.js";

function userKey(email: string, key: string): string {
  return `u:${email.trim().toLowerCase()}:${key}`;
}

function legacyUserKey(email: string, key: string): string {
  return `u:${email}:${key}`;
}

export async function getUserSetting(
  email: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  const normalized = await getSetting(userKey(email, key));
  if (normalized !== null) return normalized;
  const legacy = legacyUserKey(email, key);
  return legacy === userKey(email, key) ? null : getSetting(legacy);
}

export async function getUserSettings(
  emails: readonly string[],
  key: string,
): Promise<Map<string, Record<string, unknown> | null>> {
  const uniqueEmails = [...new Set(emails)];
  const result = new Map<string, Record<string, unknown> | null>();
  if (uniqueEmails.length === 0) return result;

  const normalized = await getSettings(
    uniqueEmails.map((email) => userKey(email, key)),
  );

  const legacyKeyByEmail = new Map<string, string>();
  for (const email of uniqueEmails) {
    const normalizedKey = userKey(email, key);
    const normalizedValue = normalized.get(normalizedKey) ?? null;
    if (normalizedValue !== null) {
      result.set(email, normalizedValue);
      continue;
    }
    const legacy = legacyUserKey(email, key);
    if (legacy === normalizedKey) {
      result.set(email, null);
    } else {
      legacyKeyByEmail.set(email, legacy);
    }
  }

  if (legacyKeyByEmail.size > 0) {
    const legacy = await getSettings([...legacyKeyByEmail.values()]);
    for (const [email, legacyKey] of legacyKeyByEmail) {
      result.set(email, legacy.get(legacyKey) ?? null);
    }
  }

  return result;
}

export async function putUserSetting(
  email: string,
  key: string,
  value: Record<string, unknown>,
  options?: StoreWriteOptions,
): Promise<void> {
  return putSetting(userKey(email, key), value, options);
}

export async function mutateUserSetting(
  email: string,
  key: string,
  updater: (
    current: Record<string, unknown> | null,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  options?: StoreWriteOptions,
): Promise<Record<string, unknown>> {
  const normalized = userKey(email, key);
  const legacy = legacyUserKey(email, key);
  let migratedLegacy = false;
  let migratedLegacyValue: Record<string, unknown> | null = null;
  const result = await mutateSetting(
    normalized,
    async (current) => {
      if (current !== null) {
        migratedLegacy = false;
        migratedLegacyValue = null;
        return updater(current);
      }
      const legacyCurrent =
        legacy === normalized
          ? null
          : await getSetting(legacy, { bypassCache: true });
      migratedLegacy = legacyCurrent !== null;
      migratedLegacyValue = legacyCurrent;
      return updater(legacyCurrent);
    },
    options,
  );
  if (!migratedLegacy) return result;

  // If the legacy row disappeared after the updater read it, a concurrent
  // delete won the race. Remove only our exact canonical write; never delete
  // a newer canonical value from another writer.
  if (
    !migratedLegacyValue ||
    !(await deleteSettingIfValue(legacy, migratedLegacyValue, options))
  ) {
    if (await getSetting(legacy, { bypassCache: true })) return result;
    const removed = await deleteSettingIfValue(normalized, result, options);
    if (!removed) {
      return result;
    }
    throw new Error("User setting was deleted while migrating its legacy key");
  }
  return result;
}

export async function deleteUserSetting(
  email: string,
  key: string,
  options?: StoreWriteOptions,
): Promise<boolean> {
  const normalized = userKey(email, key);
  const legacy = legacyUserKey(email, key);
  const normalizedCurrent = await getSetting(normalized, {
    bypassCache: true,
  });
  if (legacy === normalized) {
    return normalizedCurrent === null
      ? false
      : deleteSettingIfValue(normalized, normalizedCurrent, options);
  }

  const legacyCurrent = await getSetting(legacy, { bypassCache: true });

  const deletedLegacy =
    legacyCurrent === null
      ? false
      : await deleteSettingIfValue(legacy, legacyCurrent, options);
  const normalizedAfterLegacyCleanup =
    normalizedCurrent === null && deletedLegacy
      ? await getSetting(normalized, { bypassCache: true })
      : normalizedCurrent;
  const deletedNormalized =
    normalizedAfterLegacyCleanup === null
      ? false
      : await deleteSettingIfValue(
          normalized,
          normalizedAfterLegacyCleanup,
          options,
        );
  return deletedNormalized || deletedLegacy;
}
