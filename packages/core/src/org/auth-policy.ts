import { getCurrentAdapter } from "better-auth";

import { getAppConfig } from "../app-config/index.js";
import { getDbExec } from "../db/client.js";
import { invalidateSessionEmailCache } from "../server/session-email-cache.js";

export type RequiredAuthProvider = "google" | `sso:${string}` | null;
export type ResolvedRequiredAuthProvider = RequiredAuthProvider | "conflict";

export const GOOGLE_AUTH_REQUIRED_MESSAGE =
  "This organization requires Google sign-in.";

export const SSO_AUTH_REQUIRED_MESSAGE =
  "This organization requires single sign-on.";

export function authProviderRequiredMessage(
  provider: ResolvedRequiredAuthProvider,
): string {
  if (provider === "conflict") {
    return "Your organizations require conflicting sign-in providers. Contact an administrator.";
  }
  return provider?.startsWith("sso:")
    ? SSO_AUTH_REQUIRED_MESSAGE
    : GOOGLE_AUTH_REQUIRED_MESSAGE;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function providerFromRow(row: Record<string, unknown>): RequiredAuthProvider {
  const provider = row.provider == null ? "" : String(row.provider);
  if (!provider) return null;
  if (provider === "google") return provider;
  if (!provider.startsWith("sso:") || provider.slice(4).trim() === "") {
    throw new Error(
      `Unsupported organization auth provider: ${String(provider)}`,
    );
  }
  return provider as `sso:${string}`;
}

function isMissingOrgAuthPolicySchema(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "42P01" || candidate.code === "42703") return true;
  return /relation ["']?(organizations|org_members|org_invitations)["']? does not exist|column ["']?required_auth_provider["']? does not exist/i.test(
    String(candidate.message ?? error),
  );
}

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
): Promise<ResolvedRequiredAuthProvider> {
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
                    AND m.federation_removal_pending_at IS NULL
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
            ORDER BY o.id`,
      args: [normalizedEmail, normalizedEmail, domain],
    });
  } catch (error) {
    if (isMissingOrgAuthPolicySchema(error)) return null;
    throw error;
  }

  if (result.rows.length === 0) return null;

  const providers = new Set(
    result.rows.map((row) => providerFromRow(row as Record<string, unknown>)),
  );
  providers.delete(null);
  if (providers.size === 0) return null;
  if (providers.size > 1) return "conflict";
  return [...providers][0] ?? null;
}

export async function isGoogleSignInRequiredForEmail(
  email: string,
): Promise<boolean> {
  return (await getRequiredAuthProviderForEmail(email)) === "google";
}

export async function getAuthEmailForUserId(
  userId: string,
  adapter?: Parameters<typeof getCurrentAdapter>[0],
): Promise<string> {
  let email: unknown;
  if (adapter) {
    const user = await (
      await getCurrentAdapter(adapter)
    ).findOne<{
      email: string;
    }>({ model: "user", where: [{ field: "id", value: userId }] });
    email = user?.email;
  } else {
    const result = await getDbExec().execute({
      sql: 'SELECT email FROM "user" WHERE id = ? LIMIT 1',
      args: [userId],
    });
    email = result.rows[0]?.email;
  }
  if (typeof email !== "string" || !email) {
    throw new Error(`Better Auth user email not found: ${userId}`);
  }
  return email;
}

function isMissingLegacySessionTable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "42P01") return true;
  return /relation ["']?sessions["']? does not exist/i.test(
    String(candidate.message ?? error),
  );
}

export async function setRequiredAuthProvider(
  orgId: string,
  provider: RequiredAuthProvider,
): Promise<{
  revokedBetterAuthSessions: number;
  revokedLegacySessions: number;
}> {
  if (
    provider !== "google" &&
    provider !== null &&
    (!provider.startsWith("sso:") || provider.slice(4).trim() === "")
  ) {
    throw new Error(
      `Unsupported organization auth provider: ${String(provider)}`,
    );
  }

  if (provider?.startsWith("sso:")) {
    if (!getAppConfig().access.sso.enabled) {
      throw new Error("SSO is not enabled for this deployment");
    }
    const providerId = provider.slice(4);
    const configured = await dbQuerySSOProvider(orgId, providerId);
    if (!configured) {
      throw new Error(
        "The selected SSO provider must belong to this organization and have a verified domain",
      );
    }
  }

  const db = getDbExec();
  await db.execute({
    sql: `UPDATE organizations
          SET required_auth_provider = ?
          WHERE id = ?`,
    args: [provider, orgId],
  });

  if (provider === null) {
    return { revokedBetterAuthSessions: 0, revokedLegacySessions: 0 };
  }

  const betterAuthResult = await db.execute({
    sql: `DELETE FROM "session"
          WHERE user_id IN (
            SELECT u.id
            FROM "user" u
            INNER JOIN org_members m ON LOWER(m.email) = LOWER(u.email)
            WHERE m.org_id = ?
              AND m.federation_removal_pending_at IS NULL
          )`,
    args: [orgId],
  });

  let legacyResult: { rowsAffected?: number } = {};
  try {
    legacyResult = await db.execute({
      sql: `DELETE FROM sessions
            WHERE LOWER(email) IN (
              SELECT LOWER(email) FROM org_members
              WHERE org_id = ? AND federation_removal_pending_at IS NULL
            )`,
      args: [orgId],
    });
  } catch (error) {
    if (!isMissingLegacySessionTable(error)) throw error;
  }
  invalidateSessionEmailCache();

  return {
    revokedBetterAuthSessions: Number(betterAuthResult.rowsAffected ?? 0),
    revokedLegacySessions: Number(legacyResult.rowsAffected ?? 0),
  };
}

async function dbQuerySSOProvider(
  orgId: string,
  providerId: string,
): Promise<boolean> {
  try {
    const result = await getDbExec().execute({
      sql: `SELECT 1 FROM sso_provider
            WHERE organization_id = ?
              AND provider_id = ?
              AND domain_verified = TRUE
            LIMIT 1`,
      args: [orgId, providerId],
    });
    return result.rows.length > 0;
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (
      candidate.code === "42P01" ||
      /relation ["']?sso_provider["']? does not exist/i.test(
        String(candidate.message ?? error),
      )
    ) {
      return false;
    }
    throw error;
  }
}
