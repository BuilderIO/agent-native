import { getDbExec } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

export type ContentSpaceRole = "viewer" | "editor" | "owner";

export type ContentSpaceAccess = {
  space: typeof schema.contentSpaces.$inferSelect;
  authority: { userEmail: string; orgId: string | null };
  role: ContentSpaceRole;
};

type ContentOrganizationMembership = {
  role: string;
  name: string;
  createdBy: string;
  identityAuthority: unknown;
  identityId: unknown;
};

export function normalizeContentSpaceEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("no authenticated user");
  return normalized;
}

async function revalidateFederatedMembership(
  orgId: string,
  email: string,
  membership: ContentOrganizationMembership,
): Promise<ContentOrganizationMembership | null> {
  const identityAuthority = String(membership.identityAuthority ?? "").trim();
  const identityId = String(membership.identityId ?? "").trim();
  if (!identityAuthority && !identityId) return membership;

  const { validateFederatedOrganizationMembershipForCurrentRequest } =
    await import("@agent-native/core/org");
  const validation =
    await validateFederatedOrganizationMembershipForCurrentRequest({
      orgId,
      email,
    });
  if (!validation.active) return null;
  return {
    ...membership,
    role: validation.role ?? membership.role,
  };
}

export async function getContentOrganizationMembership(
  orgId: string,
  userEmail: string,
  options: { db?: any } = {},
): Promise<{ role: string; name: string; createdBy: string } | null> {
  if (options.db) {
    // The canonical tables carry the active database dialect. Loading them only
    // for transaction-scoped checks avoids initializing auth timers elsewhere.
    const { organizations, orgMembers } =
      await import("@agent-native/core/org");
    const [row] = await options.db
      .select({
        role: orgMembers.role,
        name: organizations.name,
        createdBy: organizations.createdBy,
        identityAuthority: organizations.identityAuthority,
        identityId: organizations.identityId,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(
        and(
          eq(orgMembers.orgId, orgId),
          isNull(orgMembers.federationRemovalPendingAt),
          sql`LOWER(${orgMembers.email}) = ${normalizeContentSpaceEmail(userEmail)}`,
        ),
      )
      .limit(1);
    if (!row) return null;
    return revalidateFederatedMembership(orgId, userEmail, {
      role: (typeof row.role === "string"
        ? row.role
        : (JSON.stringify(row.role) ?? "member")
      ).toLowerCase(),
      name: row.name,
      createdBy: row.createdBy,
      identityAuthority: row.identityAuthority,
      identityId: row.identityId,
    });
  }
  const result = await getDbExec().execute({
    sql: `SELECT m.role AS role, o.name AS name, o.created_by AS "createdBy",
                 o.identity_authority AS "identityAuthority",
                 o.identity_id AS "identityId"
          FROM org_members m
          INNER JOIN organizations o ON o.id = m.org_id
          WHERE m.org_id = ? AND LOWER(m.email) = ?
            AND m.federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [orgId, normalizeContentSpaceEmail(userEmail)],
  });
  const row = result.rows[0] as
    | {
        role?: unknown;
        name?: unknown;
        createdBy?: unknown;
        identityAuthority?: unknown;
        identityId?: unknown;
      }
    | undefined;
  if (
    !row ||
    typeof row.name !== "string" ||
    typeof row.createdBy !== "string"
  ) {
    return null;
  }
  return revalidateFederatedMembership(orgId, userEmail, {
    role: (typeof row.role === "string"
      ? row.role
      : (JSON.stringify(row.role) ?? "member")
    ).toLowerCase(),
    name: row.name,
    createdBy: row.createdBy,
    identityAuthority: row.identityAuthority,
    identityId: row.identityId,
  });
}

export async function listContentOrganizationMemberships(userEmail: string) {
  let result;
  try {
    result = await getDbExec().execute({
      sql: `SELECT m.org_id AS "orgId", m.role AS role, o.name AS name,
                 o.created_by AS "createdBy",
                 o.identity_authority AS "identityAuthority",
                 o.identity_id AS "identityId"
          FROM org_members m
          INNER JOIN organizations o ON o.id = m.org_id
          WHERE LOWER(m.email) = ?
            AND m.federation_removal_pending_at IS NULL
          ORDER BY m.org_id ASC`,
      args: [normalizeContentSpaceEmail(userEmail)],
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) {
      return [];
    }
    throw error;
  }
  const memberships = result.rows
    .map((row: any) => ({
      orgId: typeof row.orgId === "string" ? row.orgId : row.org_id,
      role: (typeof row.role === "string"
        ? row.role
        : (JSON.stringify(row.role) ?? "member")
      ).toLowerCase(),
      name: row.name,
      createdBy: row.createdBy ?? row.created_by,
      identityAuthority: row.identityAuthority ?? row.identity_authority,
      identityId: row.identityId ?? row.identity_id,
    }))
    .filter(
      (row): row is ContentOrganizationMembership & { orgId: string } =>
        typeof row.orgId === "string" &&
        typeof row.name === "string" &&
        typeof row.createdBy === "string",
    );
  return Promise.all(
    memberships.map(async ({ orgId, ...membership }) => {
      const validated = await revalidateFederatedMembership(
        orgId,
        userEmail,
        membership,
      );
      return validated ? { orgId, ...validated } : null;
    }),
  ).then((validated) =>
    validated.filter(
      (row): row is ContentOrganizationMembership & { orgId: string } =>
        row !== null,
    ),
  );
}

export async function resolveContentSpaceAccess(
  spaceId: string,
  requiredRole: "viewer" | "contributor" | "editor" = "viewer",
  options: { db?: any } = {},
): Promise<ContentSpaceAccess> {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const normalizedUserEmail = normalizeContentSpaceEmail(userEmail);
  const [space] = await (options.db ?? getDb())
    .select()
    .from(schema.contentSpaces)
    .where(eq(schema.contentSpaces.id, spaceId));
  if (!space || space.archivedAt)
    throw new Error(`Content space "${spaceId}" not found`);

  if (!space.orgId) {
    if (normalizeContentSpaceEmail(space.ownerEmail) !== normalizedUserEmail) {
      throw new Error(`Not authorized for Content space "${spaceId}"`);
    }
    return {
      space,
      authority: { userEmail: normalizedUserEmail, orgId: null },
      role: "owner",
    };
  }

  const membership = await getContentOrganizationMembership(
    space.orgId,
    normalizedUserEmail,
    options,
  );
  if (!membership)
    throw new Error(`Not authorized for Content space "${spaceId}"`);
  const role: ContentSpaceRole =
    membership.role === "owner"
      ? "owner"
      : membership.role === "admin"
        ? "editor"
        : "viewer";
  if (
    requiredRole === "contributor" &&
    membership.role !== "owner" &&
    membership.role !== "admin" &&
    membership.role !== "member"
  ) {
    throw new Error(
      `Contributor access is required for Content space "${spaceId}"`,
    );
  }
  if (requiredRole === "editor" && role === "viewer") {
    throw new Error(`Editor access is required for Content space "${spaceId}"`);
  }
  return {
    space,
    authority: { userEmail: normalizedUserEmail, orgId: space.orgId },
    role,
  };
}
