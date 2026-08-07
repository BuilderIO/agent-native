import { getDbExec } from "../db/client.js";
import { invalidateSessionEmailCache } from "../server/session-email-cache.js";

export type RequiredAuthProvider = "google" | null;

export const GOOGLE_AUTH_REQUIRED_MESSAGE =
  "This organization requires Google sign-in.";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function providerFromRow(row: Record<string, unknown>): RequiredAuthProvider {
  const provider = row.provider == null ? "" : String(row.provider);
  if (!provider) return null;
  if (provider !== "google") {
    throw new Error(`Unsupported organization auth provider: ${provider}`);
  }
  return "google";
}

function isMissingOrgAuthPolicySchema(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "42P01" || candidate.code === "42703") return true;
  return /no such table:\s*(organizations|org_members|org_invitations)|no such column:\s*required_auth_provider|relation ["']?(organizations|org_members|org_invitations)["']? does not exist|column ["']?required_auth_provider["']? does not exist/i.test(
    String(candidate.message ?? error),
  );
}

/** Resolve the active auth requirement for an organization. */
export async function getRequiredAuthProviderForOrg(
  orgId: string,
): Promise<RequiredAuthProvider> {
  let result;
  try {
    result = await getDbExec().execute({
      sql: `SELECT required_auth_provider AS provider
            FROM organizations
            WHERE id = ?
            LIMIT 1`,
      args: [orgId],
    });
  } catch (error) {
    // Apps that do not mount the org plugin have no policy surface. This is a
    // known absence, while every other read failure must remain loud.
    if (isMissingOrgAuthPolicySchema(error)) return null;
    throw error;
  }
  if (result.rows.length === 0) {
    throw new Error(`Organization not found: ${orgId}`);
  }
  return providerFromRow(result.rows[0] as Record<string, unknown>);
}

/**
 * Resolve an auth requirement before an account has a membership. Pending
 * invites and allowed domains must be included so password signup cannot be
 * used to create a first session for an org that requires Google.
 */
export async function getRequiredAuthProviderForEmail(
  email: string,
): Promise<RequiredAuthProvider> {
  const normalizedEmail = normalizeEmail(email);
  const domain = normalizedEmail.split("@")[1] ?? "";
  if (!normalizedEmail || !domain) return null;

  let result;
  try {
    result = await getDbExec().execute({
      sql: `SELECT o.required_auth_provider AS provider
            FROM organizations o
            WHERE o.required_auth_provider IS NOT NULL
              AND (
                EXISTS (
                  SELECT 1
                  FROM org_members m
                  WHERE m.org_id = o.id
                    AND LOWER(m.email) = ?
                )
                OR EXISTS (
                  SELECT 1
                  FROM org_invitations i
                  WHERE i.org_id = o.id
                    AND LOWER(i.email) = ?
                    AND i.status = 'pending'
                )
                OR LOWER(o.allowed_domain) = ?
              )
            LIMIT 1`,
      args: [normalizedEmail, normalizedEmail, domain],
    });
  } catch (error) {
    // The org module is optional for custom-auth apps. Do not turn its absent
    // tables into an auth outage; unreadable existing policy data still throws.
    if (isMissingOrgAuthPolicySchema(error)) return null;
    throw error;
  }

  if (result.rows.length === 0) return null;
  return providerFromRow(result.rows[0] as Record<string, unknown>);
}

export async function isGoogleSignInRequiredForEmail(
  email: string,
): Promise<boolean> {
  return (await getRequiredAuthProviderForEmail(email)) === "google";
}

/** Resolve the email used by Better Auth's session lifecycle hook. */
export async function getAuthEmailForUserId(userId: string): Promise<string> {
  const result = await getDbExec().execute({
    sql: 'SELECT email FROM "user" WHERE id = ? LIMIT 1',
    args: [userId],
  });
  const email = result.rows[0]?.email;
  if (typeof email !== "string" || !email) {
    throw new Error(`Better Auth user email not found: ${userId}`);
  }
  return email;
}

function isMissingLegacySessionTable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "42P01") return true;
  return /no such table:\s*sessions|relation ["']?sessions["']? does not exist/i.test(
    String(candidate.message ?? error),
  );
}

/**
 * Enable or disable an org auth requirement. Enabling revokes every current
 * session in both auth stores before the request returns.
 */
export async function setRequiredAuthProvider(
  orgId: string,
  provider: RequiredAuthProvider,
): Promise<{
  revokedBetterAuthSessions: number;
  revokedLegacySessions: number;
}> {
  if (provider !== "google" && provider !== null) {
    throw new Error(`Unsupported organization auth provider: ${provider}`);
  }

  const db = getDbExec();
  await db.execute({
    sql: `UPDATE organizations
          SET required_auth_provider = ?
          WHERE id = ?`,
    args: [provider, orgId],
  });

  if (provider !== "google") {
    return { revokedBetterAuthSessions: 0, revokedLegacySessions: 0 };
  }

  const betterAuthResult = await db.execute({
    sql: `DELETE FROM "session"
          WHERE user_id IN (
            SELECT u.id
            FROM "user" u
            INNER JOIN org_members m ON LOWER(m.email) = LOWER(u.email)
            WHERE m.org_id = ?
          )`,
    args: [orgId],
  });

  let legacyResult: { rowsAffected?: number } = {};
  try {
    legacyResult = await db.execute({
      sql: `DELETE FROM sessions
            WHERE LOWER(email) IN (
              SELECT LOWER(email) FROM org_members WHERE org_id = ?
            )`,
      args: [orgId],
    });
  } catch (error) {
    if (!isMissingLegacySessionTable(error)) throw error;
  }
  // Revoking a whole org's sessions must land immediately, not after the
  // resolution cache's TTL.
  invalidateSessionEmailCache();

  return {
    revokedBetterAuthSessions: Number(betterAuthResult.rowsAffected ?? 0),
    revokedLegacySessions: Number(legacyResult.rowsAffected ?? 0),
  };
}
