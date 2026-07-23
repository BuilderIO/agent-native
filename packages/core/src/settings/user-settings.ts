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
  mutateSetting,
  type StoreWriteOptions,
} from "./store.js";

function userKey(email: string, key: string): string {
  return `u:${email}:${key}`;
}

/** Read a user-scoped setting. Returns null if not set for this user. */
export async function getUserSetting(
  email: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  return getSetting(userKey(email, key));
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
  return mutateSetting(userKey(email, key), updater, options);
}

/** Delete a user-scoped setting. */
export async function deleteUserSetting(
  email: string,
  key: string,
  options?: StoreWriteOptions,
): Promise<boolean> {
  return deleteSetting(userKey(email, key), options);
}
