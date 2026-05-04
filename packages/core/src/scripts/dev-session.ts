/**
 * Dev-only session bootstrap for `pnpm action <name>` (and any other CLI
 * caller of `runScript`).
 *
 * After changes-53, db-exec / db-query / db-patch refuse to run unless
 * `getRequestUserEmail()` returns a real identity. In an HTTP request the
 * Nitro plugin wraps the handler in `runWithRequestContext({ userEmail })`
 * so scoping just works. CLI invocations have no such wrapper, so without
 * this helper every db-* CLI run hands the user a stack trace.
 *
 * What this does: when the runner is about to dispatch, resolve a real
 * email by reading the most-recent row from the legacy `sessions` table
 * (the same table that `addSession()` writes from google-oauth.ts and the
 * A2A receiver fallback already consults). The runner then wraps dispatch
 * in `runWithRequestContext({ userEmail })` so the action sees a real
 * identity.
 *
 * Strict gating mirrors the A2A precedent in
 * `server/agent-chat-plugin.ts` (search for "latest session"):
 *   - NODE_ENV !== "production".
 *   - AUTH_MODE unset or === "local" — don't auto-impersonate when an
 *     admin or hosted auth mode is in use.
 *
 * If `process.env.AGENT_USER_EMAIL` is already set we return it unchanged
 * — explicit env wins over any DB-derived guess (matches how
 * `getRequestUserEmail()` itself behaves).
 */

const DEV_FALLBACK_EMAIL = "local@localhost"; // guard:allow-localhost-fallback — sentinel intentionally rejected so the resolver doesn't return it

/**
 * Resolve the local dev user's email for the current CLI invocation.
 *
 * Returns the resolved email, or `undefined` when no real identity is
 * available. Callers should let the downstream "no authenticated user"
 * error propagate — its message points the user at the two fixes
 * (sign in via the running app, or set `AGENT_USER_EMAIL`).
 */
export async function resolveDevUserEmail(): Promise<string | undefined> {
  const explicit = process.env.AGENT_USER_EMAIL;
  if (explicit) return explicit;

  // Hard refusal: this helper must never source identity in prod.
  if (process.env.NODE_ENV === "production") return undefined;

  // AUTH_MODE may be unset (default dev shim) or "local". Anything else
  // means a non-dev auth mode is in play; don't try to fish a session
  // out of the DB on its behalf.
  const authMode = process.env.AUTH_MODE;
  if (authMode && authMode !== "local") return undefined;

  try {
    const { getDbExec } = await import("../db/client.js");
    const { rows } = await getDbExec().execute({
      sql: `SELECT email FROM sessions
            WHERE email IS NOT NULL AND email <> ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [DEV_FALLBACK_EMAIL],
    });
    const email = rows[0]?.email as string | undefined;
    return email && email.trim().length > 0 ? email : undefined;
  } catch {
    // The sessions table doesn't exist yet (fresh install where the web
    // server has never booted) or the DB isn't reachable. Either way,
    // we can't produce an identity — let the caller throw with the
    // friendlier "sign in first" hint.
    return undefined;
  }
}
