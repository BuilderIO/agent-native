/**
 * User-scoped settings helpers.
 *
 * Wraps the global settings store with per-user key prefixing.
 * Keys are stored as `u:<email>:<key>` in the settings table.
 *
 * Includes a migration fallback: if a user-scoped key is not found,
 * falls back to the global (unprefixed) key. This allows existing
 * single-user data to be read by the first user who accesses it.
 * Writes always go to the user-scoped key.
 */

import { getSetting, putSetting, deleteSetting } from "./store.js";

function userKey(email: string, key: string): string {
  return `u:${email}:${key}`;
}

/**
 * Read a user-scoped setting. Falls back to the global key if the
 * user-scoped key doesn't exist (migration path from single-user).
 */
export async function getUserSetting(
  email: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  const scoped = await getSetting(userKey(email, key));
  if (scoped !== null) return scoped;
  // Fallback to unscoped key for migration from single-user
  return getSetting(key);
}

/** Write a user-scoped setting. Always writes to the prefixed key. */
export async function putUserSetting(
  email: string,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  return putSetting(userKey(email, key), value);
}

/** Delete a user-scoped setting. */
export async function deleteUserSetting(
  email: string,
  key: string,
): Promise<boolean> {
  return deleteSetting(userKey(email, key));
}
