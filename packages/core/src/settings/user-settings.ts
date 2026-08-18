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
  putSetting,
  deleteSetting,
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

/** Delete a user-scoped setting. */
export async function deleteUserSetting(
  email: string,
  key: string,
  options?: StoreWriteOptions,
): Promise<boolean> {
  return deleteSetting(userKey(email, key), options);
}
