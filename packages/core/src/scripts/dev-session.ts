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

  if (process.env.NODE_ENV === "production") return undefined;

  const authMode = process.env.AUTH_MODE;
  if (authMode && authMode !== "local") return undefined;

  try {
    const { getDbExec } = await import("../db/client.js");
    const { rows } = await getDbExec().execute({
      sql: `SELECT email
            FROM (
              SELECT TRIM(email) AS email, MAX(created_at) AS last_seen
              FROM sessions
              WHERE email IS NOT NULL AND TRIM(email) <> ?
              GROUP BY TRIM(email)
            ) AS session_owners
            WHERE email <> ''
            ORDER BY last_seen DESC
            LIMIT 2`,
      args: [DEV_FALLBACK_EMAIL],
    });
    const emails = rows
      .map((row) => (typeof row.email === "string" ? row.email.trim() : ""))
      .filter((email) => email.length > 0);
    if (emails.length === 0) return undefined;
    if (emails.length > 1) {
      console.warn(
        `[dev-session] multiple session owners found (${emails.join(
          ", ",
        )}); set AGENT_USER_EMAIL=<email> to choose one`,
      );
      return undefined;
    }
    const email = emails[0];
    console.log(
      `[dev-session] auto-bound to ${email} (set AGENT_USER_EMAIL to override)`,
    );
    return email;
  } catch {
    return undefined;
  }
}
