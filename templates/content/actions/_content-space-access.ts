import { getDbExec } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

export type ContentSpaceRole = "viewer" | "editor" | "owner";

export type ContentSpaceAccess = {
  space: typeof schema.contentSpaces.$inferSelect;
  authority: { userEmail: string; orgId: string | null };
  role: ContentSpaceRole;
};

export function normalizeContentSpaceEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("no authenticated user");
  return normalized;
}

export async function getContentOrganizationMembership(
  orgId: string,
  userEmail: string,
): Promise<{ role: string; name: string; createdBy: string } | null> {
  const result = await getDbExec().execute({
    sql: `SELECT m.role AS role, o.name AS name, o.created_by AS "createdBy"
          FROM org_members m
          INNER JOIN organizations o ON o.id = m.org_id
          WHERE m.org_id = ? AND LOWER(m.email) = ?
          LIMIT 1`,
    args: [orgId, normalizeContentSpaceEmail(userEmail)],
  });
  const row = result.rows[0] as
    | { role?: unknown; name?: unknown; createdBy?: unknown }
    | undefined;
  if (
    !row ||
    typeof row.name !== "string" ||
    typeof row.createdBy !== "string"
  ) {
    return null;
  }
  return {
    role: String(row.role ?? "member").toLowerCase(),
    name: row.name,
    createdBy: row.createdBy,
  };
}

export async function listContentOrganizationMemberships(userEmail: string) {
  let result;
  try {
    result = await getDbExec().execute({
      sql: `SELECT m.org_id AS "orgId", m.role AS role, o.name AS name,
                 o.created_by AS "createdBy"
          FROM org_members m
          INNER JOIN organizations o ON o.id = m.org_id
          WHERE LOWER(m.email) = ?
          ORDER BY m.org_id ASC`,
      args: [normalizeContentSpaceEmail(userEmail)],
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) {
      return [];
    }
    throw error;
  }
  return result.rows
    .map((row: any) => ({
      orgId: typeof row.orgId === "string" ? row.orgId : row.org_id,
      role: String(row.role ?? "member").toLowerCase(),
      name: row.name,
      createdBy: row.createdBy ?? row.created_by,
    }))
    .filter(
      (
        row,
      ): row is {
        orgId: string;
        role: string;
        name: string;
        createdBy: string;
      } =>
        typeof row.orgId === "string" &&
        typeof row.name === "string" &&
        typeof row.createdBy === "string",
    );
}

export async function resolveContentSpaceAccess(
  spaceId: string,
  requiredRole: "viewer" | "editor" = "viewer",
): Promise<ContentSpaceAccess> {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const normalizedUserEmail = normalizeContentSpaceEmail(userEmail);
  const [space] = await getDb()
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
  );
  if (!membership)
    throw new Error(`Not authorized for Content space "${spaceId}"`);
  const role: ContentSpaceRole =
    membership.role === "owner"
      ? "owner"
      : membership.role === "admin"
        ? "editor"
        : "viewer";
  if (requiredRole === "editor" && role === "viewer") {
    throw new Error(`Editor access is required for Content space "${spaceId}"`);
  }
  return {
    space,
    authority: { userEmail: normalizedUserEmail, orgId: space.orgId },
    role,
  };
}
