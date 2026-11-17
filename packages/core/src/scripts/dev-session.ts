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

/**
 * Set to "personal" on a child process whose caller acts in no org, so a
 * `pnpm action` it runs stays out of the user's orgs too. The agent's shell
 * tool sets it for a request with no org.
 */
export const AGENT_ORG_SCOPE_ENV = "AGENT_ORG_SCOPE";

export interface DevOrgChoice {
  /** An org the caller named: `AGENT_ORG_ID` or a forwarded org header. */
  orgId?: string | undefined;
  /** The caller acts in no org and must not be given one. */
  personal?: boolean | undefined;
}

/** The org choice this CLI process inherited from its environment. */
export function devOrgChoiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DevOrgChoice {
  return {
    orgId: env.AGENT_ORG_ID || undefined,
    personal: env[AGENT_ORG_SCOPE_ENV] === "personal",
  };
}

/**
 * Resolve the org scope a local CLI call acts in, for `userEmail`, as fields
 * for its request context.
 *
 * An inherited personal scope wins, then a named org. Otherwise this is the
 * org the signed-in app uses for the same user: their active org, else their
 * first membership, or none when they chose their personal space or have no
 * org. Without it, `pnpm action` ran with no org and saw only the user's
 * personal rows while the app showed their org's.
 *
 * Like the app, a membership table that can't be read counts as no org;
 * transient database errors still throw.
 */
export async function resolveDevOrgScope(
  userEmail: string | undefined,
  choice: DevOrgChoice,
): Promise<{ orgId?: string; orgScope?: "personal" }> {
  // Personal comes first. Only the agent's shell sets it, for a request with
  // no org, and the child's own env loading can put an AGENT_ORG_ID from
  // `.env` back, which must not give the command an org.
  if (choice.personal) return { orgScope: "personal" };
  if (choice.orgId) return { orgId: choice.orgId };
  if (!userEmail) return {};
  if (await localDatabaseIsMissing()) return {};
  const { resolveOrgIdForEmail } = await import("../org/context.js");
  const orgId = await resolveOrgIdForEmail(userEmail);
  return orgId ? { orgId } : {};
}

/**
 * True when the app's local PGlite database hasn't been created yet. It has
 * no orgs, and opening it to look would create it and run every migration,
 * which takes many seconds for an action that may not touch the database.
 */
async function localDatabaseIsMissing(): Promise<boolean> {
  const {
    getRuntimeDatabaseUrl,
    isPgliteUrl,
    pgliteDataDirFromUrl,
    pgliteRuntimeDataDir,
  } = await import("../db/client.js");
  const url = getRuntimeDatabaseUrl("pglite:./data/pglite");
  if (!isPgliteUrl(url)) return false;
  const dataDir = pgliteRuntimeDataDir(pgliteDataDirFromUrl(url));
  if (dataDir === "memory://") return false;
  const fs = await import("node:fs");
  return !fs.existsSync(dataDir);
}
