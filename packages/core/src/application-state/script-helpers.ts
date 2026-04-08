/**
 * Application state helpers for use in scripts.
 *
 * Scripts run as standalone processes without HTTP context.
 * The session ID is resolved from the AGENT_USER_EMAIL env var
 * (set by the agent runtime for per-user data isolation), defaulting to
 * "local" for backward compatibility in dev mode.
 */

import {
  appStateGet,
  appStatePut,
  appStateDelete,
  appStateList,
  appStateDeleteByPrefix,
} from "./store.js";
import { getDbExec } from "../db/client.js";

let _resolvedSessionId: string | undefined;

/**
 * Resolve session ID, checking AGENT_USER_EMAIL first, then falling back to
 * the most recent session in the DB. This ensures CLI actions write to the
 * same session partition as the logged-in UI user.
 */
async function resolveSessionId(): Promise<string> {
  if (_resolvedSessionId) return _resolvedSessionId;

  const email = process.env.AGENT_USER_EMAIL;
  if (email && email !== "local@localhost") {
    _resolvedSessionId = email;
    return email;
  }
  if (email === "local@localhost") {
    _resolvedSessionId = "local";
    return "local";
  }

  // No AGENT_USER_EMAIL set — check DB for the most recent session
  try {
    const db = getDbExec();
    const { rows } = await db.execute({
      sql: "SELECT email FROM sessions ORDER BY created_at DESC LIMIT 1",
      args: [],
    });
    if (rows[0]) {
      const dbEmail = rows[0].email as string;
      if (dbEmail && dbEmail !== "local@localhost") {
        _resolvedSessionId = dbEmail;
        return dbEmail;
      }
    }
  } catch {
    // sessions table may not exist yet — fall through
  }

  _resolvedSessionId = "local";
  return "local";
}

export async function readAppState(
  key: string,
): Promise<Record<string, unknown> | null> {
  const sessionId = await resolveSessionId();
  return appStateGet(sessionId, key);
}

export async function writeAppState(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const sessionId = await resolveSessionId();
  return appStatePut(sessionId, key, value, {
    requestSource: "agent",
  });
}

export async function deleteAppState(key: string): Promise<boolean> {
  const sessionId = await resolveSessionId();
  return appStateDelete(sessionId, key, {
    requestSource: "agent",
  });
}

export async function listAppState(
  prefix: string,
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  const sessionId = await resolveSessionId();
  return appStateList(sessionId, prefix);
}

export async function deleteAppStateByPrefix(prefix: string): Promise<number> {
  const sessionId = await resolveSessionId();
  return appStateDeleteByPrefix(sessionId, prefix, {
    requestSource: "agent",
  });
}
