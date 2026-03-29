/**
 * Application state helpers for use in scripts.
 *
 * Scripts run as standalone processes without HTTP context.
 * The session ID is resolved from the AGENT_USER_EMAIL env var
 * (set by the agent runtime for multi-user apps), defaulting to
 * "local" for backward compatibility in dev mode.
 */

import {
  appStateGet,
  appStatePut,
  appStateDelete,
  appStateList,
  appStateDeleteByPrefix,
} from "./store.js";

function getScriptSessionId(): string {
  const email = process.env.AGENT_USER_EMAIL;
  // Map "local@localhost" → "local" to match the server handler convention
  if (!email || email === "local@localhost") return "local";
  return email;
}

export async function readAppState(
  key: string,
): Promise<Record<string, unknown> | null> {
  return appStateGet(getScriptSessionId(), key);
}

export async function writeAppState(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  return appStatePut(getScriptSessionId(), key, value);
}

export async function deleteAppState(key: string): Promise<boolean> {
  return appStateDelete(getScriptSessionId(), key);
}

export async function listAppState(
  prefix: string,
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  return appStateList(getScriptSessionId(), prefix);
}

export async function deleteAppStateByPrefix(prefix: string): Promise<number> {
  return appStateDeleteByPrefix(getScriptSessionId(), prefix);
}
