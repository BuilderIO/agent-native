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
    // The sessions table doesn't exist yet (fresh install where the web
    // server has never booted) or the DB isn't reachable. Either way,
    // we can't produce an identity — let the caller throw with the
    // friendlier "sign in first" hint.
    return undefined;
  }
}

const MISSING_ORG_TABLE_RE =
  /relation\s+["'`]?(?:org_members|organizations)["'`]?\s+does not exist|no such table:\s*(?:org_members|organizations)\b/i;

/**
 * Resolve the org a local CLI call acts in, for `userEmail`.
 *
 * An explicit org (`AGENT_ORG_ID`, or the org header a forwarded call
 * carries) wins. Otherwise this is the org the signed-in app uses for the
 * same user: their active org, else their first membership, or none when
 * they chose their personal space. Without it, `pnpm action` ran with no org
 * and saw only the user's personal rows while the app showed their org's.
 */
export async function resolveDevOrgId(
  userEmail: string | undefined,
  explicitOrgId: string | undefined,
): Promise<string | undefined> {
  if (explicitOrgId) return explicitOrgId;
  if (!userEmail) return undefined;
  try {
    const { resolveOrgIdForEmail } = await import("../org/context.js");
    return (await resolveOrgIdForEmail(userEmail)) ?? undefined;
  } catch (error) {
    // A fresh install has no org tables until the app first boots, so no
    // user can be in an org yet. Anything else is a real failure; acting
    // without the org would quietly hide the user's org rows.
    if (error instanceof Error && MISSING_ORG_TABLE_RE.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}
