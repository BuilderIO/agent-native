/**
 * Settings helpers for use in scripts.
 *
 * Persistent key-value settings stored in the settings SQL table.
 */

import { getSetting, putSetting, deleteSetting } from "./store.js";

export async function readSetting(
  key: string,
): Promise<Record<string, unknown> | null> {
  return getSetting(key);
}

export async function writeSetting(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  return putSetting(key, value);
}

export async function removeSetting(key: string): Promise<boolean> {
  return deleteSetting(key);
}
