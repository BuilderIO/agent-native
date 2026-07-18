import { createHash } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { getOrgContext } from "@agent-native/core/org";
import { getCurrentBetterAuthSession } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import type { H3Event } from "h3";

import { getDb, schema } from "../db/index.js";

type AdmissionRole = "owner" | "admin" | "member";

export interface PrivateVaultGenesisAccountScope {
  subjectId: string;
  ownerEmail: string;
  orgId: string;
  role: AdmissionRole;
  accountId: string;
  workspaceId: string;
}

function stableCoordinate(kind: "account" | "workspace", value: string) {
  return `${kind}:${createHash("sha256")
    .update(`anc/v1/content-private-vault/${kind}\0`)
    .update(value)
    .digest("hex")}`;
}

/**
 * Resolves the authority scope for genesis from current database truth.
 *
 * Requiring a matching Better Auth user row deliberately excludes legacy,
 * embed, desktop-broker, access-token, and BYOA sessions that only happen to
 * carry an email. Requiring the org_members join on every call also prevents a
 * stale session's cached organization role from surviving membership removal.
 */
export async function resolvePrivateVaultGenesisAccountScope(input: {
  userId: string;
  email: string;
  orgId: string;
}): Promise<PrivateVaultGenesisAccountScope | null> {
  const userId = input.userId.trim();
  const ownerEmail = input.email.trim().toLowerCase();
  const orgId = input.orgId.trim();
  if (
    !userId ||
    userId.length > 512 ||
    !ownerEmail ||
    ownerEmail.length > 320 ||
    !orgId ||
    orgId.length > 160
  ) {
    return null;
  }

  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT m.role AS role
            FROM "user" u
            INNER JOIN org_members m ON LOWER(m.email) = LOWER(u.email)
            WHERE u.id = ?
              AND LOWER(u.email) = ?
              AND m.org_id = ?
            LIMIT 1`,
      args: [userId, ownerEmail, orgId],
    });
    const role = String(rows[0]?.role ?? rows[0]?.[0] ?? "");
    if (role !== "owner" && role !== "admin" && role !== "member") {
      return null;
    }
    return {
      subjectId: userId,
      ownerEmail,
      orgId,
      role,
      accountId: stableCoordinate("account", `better-auth:${userId}`),
      workspaceId: stableCoordinate("workspace", `organization:${orgId}`),
    };
  } catch {
    return null;
  }
}

/** Resolve a requested vault through stable subject/workspace coordinates. */
export async function resolveAuthenticatedPrivateVaultScope(
  event: H3Event,
  vaultId: string,
): Promise<{ ownerEmail: string; orgId: string; vaultId: string } | null> {
  const session = await getCurrentBetterAuthSession(event).catch(() => null);
  if (!session?.email || !session.userId) return null;
  const org = await getOrgContext(event).catch(() => null);
  if (
    !org?.orgId ||
    org.email.trim().toLowerCase() !== session.email.trim().toLowerCase()
  ) {
    return null;
  }
  return resolvePrivateVaultScopeForStableIdentity({
    userId: session.userId,
    email: session.email,
    orgId: org.orgId,
    vaultId,
  });
}

/** Resolve the beta's one personal vault without accepting a caller vault ID. */
export async function resolveAuthenticatedPrivateVaultBootstrapScope(
  event: H3Event,
): Promise<{ ownerEmail: string; orgId: string; vaultId: string } | null> {
  const session = await getCurrentBetterAuthSession(event).catch(() => null);
  if (!session?.email || !session.userId) return null;
  const org = await getOrgContext(event).catch(() => null);
  if (
    !org?.orgId ||
    org.email.trim().toLowerCase() !== session.email.trim().toLowerCase()
  ) {
    return null;
  }
  const logical = await resolvePrivateVaultGenesisAccountScope({
    userId: session.userId,
    email: session.email,
    orgId: org.orgId,
  });
  if (!logical) return null;
  const [vault] = await getDb()
    .select({
      ownerEmail: schema.contentEncryptedVaults.ownerEmail,
      orgId: schema.contentEncryptedVaults.orgId,
      vaultId: schema.contentEncryptedVaults.vaultId,
    })
    .from(schema.contentEncryptedVaults)
    .where(
      and(
        eq(schema.contentEncryptedVaults.accountId, logical.accountId),
        eq(schema.contentEncryptedVaults.workspaceId, logical.workspaceId),
        eq(schema.contentEncryptedVaults.vaultState, "active"),
      ),
    )
    .limit(1);
  return vault ?? null;
}

export async function resolvePrivateVaultScopeForStableIdentity(input: {
  userId: string;
  email: string;
  orgId: string;
  vaultId: string;
}): Promise<{ ownerEmail: string; orgId: string; vaultId: string } | null> {
  const logical = await resolvePrivateVaultGenesisAccountScope(input);
  if (!logical) return null;
  const [vault] = await getDb()
    .select({
      ownerEmail: schema.contentEncryptedVaults.ownerEmail,
      orgId: schema.contentEncryptedVaults.orgId,
      vaultId: schema.contentEncryptedVaults.vaultId,
    })
    .from(schema.contentEncryptedVaults)
    .where(
      and(
        eq(schema.contentEncryptedVaults.vaultId, input.vaultId),
        eq(schema.contentEncryptedVaults.accountId, logical.accountId),
        eq(schema.contentEncryptedVaults.workspaceId, logical.workspaceId),
        eq(schema.contentEncryptedVaults.vaultState, "active"),
      ),
    )
    .limit(1);
  return vault ?? null;
}
