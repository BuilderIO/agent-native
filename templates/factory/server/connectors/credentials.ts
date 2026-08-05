import { resolveCredential } from "@agent-native/core/credentials";
import { orgMembers, resolveOrgIdForEmail } from "@agent-native/core/org";
import { readAppSecret } from "@agent-native/core/secrets";
import { eq, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";

function getVaultOrgId(): string | undefined {
  return process.env.AGENT_VAULT_ORG_ID?.trim() || undefined;
}

export interface ResolveConnectorSecretOptions {
  orgId?: string | null;
}

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /no such table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

export class VaultUnavailableError extends Error {
  cause: unknown;

  constructor(cause: unknown) {
    super(
      "Couldn't reach the secret vault (transient) - retry in a moment. The key may be configured; this is not a missing-key error.",
    );
    this.cause = cause;
  }
}

async function listOrgIdsForEmail(userEmail: string): Promise<string[]> {
  const rows = await getDb()
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(sql`lower(${orgMembers.email})`, userEmail));
  return Array.from(new Set(rows.map((row) => row.orgId).filter(Boolean)));
}

async function readVaultSecret(
  key: string,
  scope: "user" | "org" | "workspace",
  scopeId: string,
  attempts = 3,
  delayMs = 250,
): Promise<string | undefined> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const secret = await readAppSecret({ key, scope, scopeId });
      return secret?.value?.trim() || undefined;
    } catch (error) {
      if (isMissingTableError(error)) return undefined;
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayMs * (attempt + 1)),
        );
      }
    }
  }
  throw new VaultUnavailableError(lastError);
}

/**
 * Resolve a workspace connector key without assuming the caller's active org.
 * Dispatch may sync a workspace key under another org, so memberships and the
 * designated vault org are part of the lookup rather than a fallback afterthought.
 */
export async function resolveConnectorSecret(
  key: string,
  ownerEmail: string,
  options: ResolveConnectorSecretOptions = {},
): Promise<string | undefined> {
  const userEmail = ownerEmail.trim().toLowerCase();
  const primaryOrgId =
    options.orgId?.trim() || (await resolveOrgIdForEmail(userEmail));

  const userSecret = await readVaultSecret(key, "user", userEmail);
  if (userSecret) return userSecret;

  const membershipOrgIds = await listOrgIdsForEmail(userEmail);
  const orgIds = Array.from(
    new Set(
      [primaryOrgId, ...membershipOrgIds].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  );

  for (const orgId of orgIds) {
    for (const scope of ["org", "workspace"] as const) {
      const scopedSecret = await readVaultSecret(key, scope, orgId);
      if (scopedSecret) return scopedSecret;
    }
  }

  if (orgIds.length === 0) {
    const soloSecret = await readVaultSecret(
      key,
      "workspace",
      `solo:${userEmail}`,
    );
    if (soloSecret) return soloSecret;
  }

  for (const orgId of orgIds.length > 0 ? orgIds : [undefined]) {
    const legacySecret = await resolveCredential(key, { userEmail, orgId });
    if (legacySecret?.trim()) return legacySecret.trim();
  }

  const vaultOrgId = getVaultOrgId();
  if (vaultOrgId && !orgIds.includes(vaultOrgId)) {
    for (const scope of ["org", "workspace"] as const) {
      const vaultSecret = await readVaultSecret(key, scope, vaultOrgId);
      if (vaultSecret) return vaultSecret;
    }
  }

  // Deployment-managed connector configuration is the last resort inside the
  // resolver, never a parallel path in a provider client. A designated
  // Dispatch vault must win over a stale deployment copy of the same key.
  const environmentSecret = process.env[key]?.trim(); // guard:allow-env-credential - deploy-level connector fallback
  if (environmentSecret) return environmentSecret;

  return undefined;
}
