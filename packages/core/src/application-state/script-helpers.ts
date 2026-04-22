/**
 * Application state helpers for use in scripts and actions.
 *
 * The session ID determines which user's application state is read/written.
 * Resolution order:
 *   1. Per-request context (AsyncLocalStorage) — set by the HTTP handler
 *   2. AGENT_USER_EMAIL env var — set by agent runtime or CLI
 *   3. Most recent session in the DB — fallback for CLI scripts
 *   4. "local" — last resort
 *
 * The per-request context is critical in multi-user deployments: the env var
 * is process-global and gets overwritten by concurrent requests, so it cannot
 * reliably identify the caller. Only CLI scripts (single-user, no HTTP
 * context) should fall through to the env var or DB-lookup paths.
 */

import {
  appStateGet,
  appStatePut,
  appStateDelete,
  appStateList,
  appStateDeleteByPrefix,
} from "./store.js";
import { getDbExec } from "../db/client.js";

// Fallback session ID for CLI scripts (no per-request context).
// Cached after first resolution so repeated CLI calls don't hit the DB.
let _cliFallbackSessionId: string | undefined;

/**
 * Resolve session ID for the current caller.
 *
 * In an HTTP/action context, uses the per-request user email from
 * AsyncLocalStorage so concurrent users don't collide.
 * In a CLI context (no request), falls back to AGENT_USER_EMAIL or the
 * most recent session in the DB.
 */
async function resolveSessionId(): Promise<string> {
  // 1. Per-request context (AsyncLocalStorage) — always preferred
  try {
    const { getRequestUserEmail } = await import(
      "../server/request-context.js"
    );
    const ctxEmail = getRequestUserEmail();
    if (ctxEmail && ctxEmail !== "local@localhost") return ctxEmail;
    if (ctxEmail === "local@localhost") return "local";
  } catch {
    // request-context module not available (e.g. edge runtime) — fall through
  }

  // 2. AGENT_USER_EMAIL env var (CLI scripts)
  const email = process.env.AGENT_USER_EMAIL;
  if (email && email !== "local@localhost") return email;
  if (email === "local@localhost") return "local";

  // 3. DB fallback — cached per-process for CLI scripts only
  if (_cliFallbackSessionId) return _cliFallbackSessionId;

  try {
    const db = getDbExec();
    const { rows } = await db.execute({
      sql: "SELECT email FROM sessions ORDER BY created_at DESC LIMIT 1",
      args: [],
    });
    if (rows[0]) {
      const dbEmail = rows[0].email as string;
      if (dbEmail && dbEmail !== "local@localhost") {
        _cliFallbackSessionId = dbEmail;
        return dbEmail;
      }
    }
  } catch {
    // sessions table may not exist yet — fall through
  }

  _cliFallbackSessionId = "local";
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
