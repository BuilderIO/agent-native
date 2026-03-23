/**
 * Application state helpers for use in scripts.
 *
 * Scripts run as standalone processes without HTTP context,
 * so these use a fixed session ID ("local" for now).
 */

import {
  appStateGet,
  appStatePut,
  appStateDelete,
  appStateList,
  appStateDeleteByPrefix,
} from "./store.js";

const SESSION_ID = "local";

export async function readAppState(
  key: string,
): Promise<Record<string, unknown> | null> {
  return appStateGet(SESSION_ID, key);
}

export async function writeAppState(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  return appStatePut(SESSION_ID, key, value);
}

export async function deleteAppState(key: string): Promise<boolean> {
  return appStateDelete(SESSION_ID, key);
}

export async function listAppState(
  prefix: string,
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  return appStateList(SESSION_ID, prefix);
}

export async function deleteAppStateByPrefix(prefix: string): Promise<number> {
  return appStateDeleteByPrefix(SESSION_ID, prefix);
}
