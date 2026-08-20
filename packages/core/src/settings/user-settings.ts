/**
 * User-scoped settings helpers.
 *
 * Wraps the global settings store with per-user key prefixing.
 * Keys are stored as `u:<email>:<key>` in the settings table.
 *
 * No global fallback — each user starts with a clean slate. This
 * prevents one user's private data from leaking to other users.
 */

import {
  getSetting,
  mutateSetting,
  putSetting,
  deleteSettingIfValue,
  type StoreWriteOptions,
} from "./store.js";

function userKey(email: string, key: string): string {
  return `u:${email.trim().toLowerCase()}:${key}`;
}

/**
 * Pre-normalization spelling. Callers pass the session email verbatim, so the
 * same user could be written under `Alice@Builder.IO` and read under
 * `alice@builder.io` — silently losing settings such as `active-org-id`.
 */
function legacyUserKey(email: string, key: string): string {
  return `u:${email}:${key}`;
}

/** Read a user-scoped setting. Returns null if not set for this user. */
export async function getUserSetting(
  email: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  const normalized = await getSetting(userKey(email, key));
  if (normalized !== null) return normalized;
  const legacy = legacyUserKey(email, key);
  return legacy === userKey(email, key) ? null : getSetting(legacy);
}

/** Write a user-scoped setting. Always writes to the prefixed key. */
export async function putUserSetting(
  email: string,
  key: string,
  value: Record<string, unknown>,
  options?: StoreWriteOptions,
): Promise<void> {
  return putSetting(userKey(email, key), value, options);
}

/** Atomically derive and persist one user-scoped setting. */
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
        legacy === normalized ? null : await getSetting(legacy);
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
      // The canonical write committed successfully. A concurrent canonical
      // writer may have replaced it after the legacy row disappeared; keep
      // the committed value visible instead of making callers revoke side
      // effects for a write that is already persisted.
      return result;
    }
    throw new Error("User setting was deleted while migrating its legacy key");
  }
  return result;
}

/** Delete a user-scoped setting. */
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

  // Retire the fallback row first. If the canonical delete fails, the
  // remaining canonical value still wins reads instead of resurrecting legacy
  // data after a partial delete; a retry can safely finish the operation.
  const deletedLegacy =
    legacyCurrent === null
      ? false
      : await deleteSettingIfValue(legacy, legacyCurrent, options);
  const deletedNormalized =
    normalizedCurrent === null
      ? false
      : await deleteSettingIfValue(normalized, normalizedCurrent, options);
  return deletedNormalized || deletedLegacy;
}
