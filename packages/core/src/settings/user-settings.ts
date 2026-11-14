import {
  ACTIVE_ORG_SETTING_KEY,
  invalidateActiveOrgSettingCache,
} from "../org/request-org-cache.js";
import {
  getSetting,
  getSettingEntry,
  getSettings,
  mutateSetting,
  putSetting,
  publishSettingChange,
  invalidateSettingRequestCache,
  deleteSettingIfValue,
  type SettingEntry,
  type StoreReadOptions,
  type StoreWriteOptions,
  type StoreMutationOptions,
} from "./store.js";

function userKey(email: string, key: string): string {
  return `u:${email.trim().toLowerCase()}:${key}`;
}

function legacyUserKey(email: string, key: string): string {
  return `u:${email}:${key}`;
}

// Every user-scoped write passes through here, including the generic
// `/_agent-native/settings/:key` route, so cross-request caches of a user
// setting are dropped here. Runs even when the write throws: it may have landed.
function afterUserSettingWrite(key: string): void {
  if (key === ACTIVE_ORG_SETTING_KEY) invalidateActiveOrgSettingCache();
}

export async function getUserSetting(
  email: string,
  key: string,
  options?: Pick<StoreReadOptions, "bypassCache" | "transaction">,
): Promise<Record<string, unknown> | null> {
  const normalizedKey = userKey(email, key);
  const normalized = options
    ? await getSetting(normalizedKey, options)
    : await getSetting(normalizedKey);
  if (normalized !== null) return normalized;
  const legacy = legacyUserKey(email, key);
  if (legacy === normalizedKey) return null;
  return options ? getSetting(legacy, options) : getSetting(legacy);
}

/**
 * Like `getUserSetting`, but distinguishes an absent row from a present stored
 * JSON `null`, array or scalar. A present canonical row wins even when it
 * parses to `null`; only an absent canonical row falls back to the legacy key.
 * The legacy `getUserSetting` keeps returning `null` for both, unchanged.
 *
 * The two-key presence read is not an atomic canonical-plus-legacy snapshot
 * unless the caller supplies a suitable `transaction`/isolation: a canonical
 * row can be inserted between the canonical absence and the legacy lookup.
 * That is the existing namespace fallback pattern, not a new security bypass.
 * Mutation guard/CAS is the required write defense.
 */
export async function getUserSettingEntry(
  email: string,
  key: string,
  options?: Pick<StoreReadOptions, "bypassCache" | "transaction">,
): Promise<SettingEntry> {
  const normalizedKey = userKey(email, key);
  const normalized = options
    ? await getSettingEntry(normalizedKey, options)
    : await getSettingEntry(normalizedKey);
  if (normalized.found) return normalized;
  const legacy = legacyUserKey(email, key);
  if (legacy === normalizedKey) return { found: false };
  return options ? getSettingEntry(legacy, options) : getSettingEntry(legacy);
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
  try {
    await putSetting(userKey(email, key), value, options);
  } finally {
    afterUserSettingWrite(key);
  }
}

export async function mutateUserSetting(
  email: string,
  key: string,
  updater: (
    current: Record<string, unknown> | null,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  options?: StoreMutationOptions,
): Promise<Record<string, unknown>> {
  try {
    return await mutateUserSettingValue(email, key, updater, options);
  } finally {
    if (!options?.transaction) afterUserSettingWrite(key);
  }
}

export function publishUserSettingChange(
  email: string,
  key: string,
  options?: StoreWriteOptions,
): void {
  invalidateSettingRequestCache(legacyUserKey(email, key));
  publishSettingChange(userKey(email, key), options);
  afterUserSettingWrite(key);
}

async function mutateUserSettingValue(
  email: string,
  key: string,
  updater: (
    current: Record<string, unknown> | null,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  options?: StoreMutationOptions,
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
      const legacyReadOptions: StoreReadOptions = {
        bypassCache: true,
        ...(options?.transaction ? { transaction: options.transaction } : {}),
      };
      let legacyCurrent: Record<string, unknown> | null = null;
      if (legacy !== normalized) {
        if (options?.validateStoredValue) {
          // The entry read keeps a present JSON `null` (or array/scalar)
          // distinct from an absent legacy row, so the guard sees it before the
          // updater can migrate over it. Without a guard, the existing
          // `getSetting` migration semantics are kept exactly.
          const legacyEntry = await getSettingEntry(legacy, legacyReadOptions);
          if (legacyEntry.found) {
            await options.validateStoredValue(legacyEntry.value);
            legacyCurrent = legacyEntry.value as Record<string, unknown> | null;
          }
        } else {
          legacyCurrent = await getSetting(legacy, legacyReadOptions);
        }
      }
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
    if (
      await getSetting(legacy, {
        bypassCache: true,
        ...(options?.transaction ? { transaction: options.transaction } : {}),
      })
    )
      return result;
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
  try {
    return await deleteUserSettingValue(email, key, options);
  } finally {
    afterUserSettingWrite(key);
  }
}

async function deleteUserSettingValue(
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
