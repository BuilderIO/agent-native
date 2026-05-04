/**
 * Application state helpers for use in scripts and actions.
 *
 * The session ID determines which user's application state is read/written.
 * Resolution order:
 *   1. Per-request context (AsyncLocalStorage) — set by the HTTP handler
 *   2. AGENT_USER_EMAIL env var — CLI scripts only
 *
 * The per-request context is critical in multi-user deployments: the env var
 * is process-global and gets overwritten by concurrent requests, so it cannot
 * reliably identify the caller. Only CLI scripts (single-user, no HTTP
 * context) should fall through to the env var.
 */

import {
  appStateGet,
  appStatePut,
  appStateDelete,
  appStateList,
  appStateDeleteByPrefix,
} from "./store.js";

/**
 * Resolve session ID for the current caller.
 *
 * In an HTTP/action context, uses the per-request user email from
 * AsyncLocalStorage so concurrent users don't collide. In a CLI context
 * (no request), falls back to AGENT_USER_EMAIL. Throws when neither is
 * present — application state must be scoped to a real identity.
 */
async function resolveSessionId(): Promise<string> {
  try {
    const { getRequestUserEmail } =
      await import("../server/request-context.js");
    const ctxEmail = getRequestUserEmail();
    if (ctxEmail) return ctxEmail;
  } catch {
    // request-context not available — fall through to env var
  }

  const email = process.env.AGENT_USER_EMAIL;
  if (email) return email;

  throw new Error(
    "Application state access requires an authenticated request context or AGENT_USER_EMAIL env var",
  );
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
