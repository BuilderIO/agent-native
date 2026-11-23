import { sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import type { Queryable } from "./scope.js";

export type PendingWorkspaceInvite = {
  id: string;
  orgId: string;
  orgName: string;
  invitedBy: string;
};

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function isMissingTable(error: unknown): boolean {
  return /org_invitations|organizations/i.test(
    String((error as { message?: unknown })?.message ?? error),
  );
}

export async function listPendingWorkspaceInvites(
  rawEmail: string | null | undefined,
  db: Queryable = getDb(),
): Promise<PendingWorkspaceInvite[]> {
  const email = (rawEmail ?? "").trim().toLowerCase();
  if (!email) return [];
  try {
    const result = await db.execute(
      sql`SELECT i.id AS id, i.org_id AS org_id, o.name AS org_name, i.invited_by AS invited_by
          FROM org_invitations i
          INNER JOIN organizations o ON o.id = i.org_id
          WHERE LOWER(i.email) = ${email} AND i.status = 'pending'
          ORDER BY i.created_at DESC`,
    );
    return rowsOf(result).map((row) => ({
      id: String(row.id),
      orgId: String(row.org_id),
      orgName: String(row.org_name ?? ""),
      invitedBy: String(row.invited_by ?? ""),
    }));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function hasPendingWorkspaceInvite(
  rawEmail: string | null | undefined,
  orgId: string | null | undefined,
  db: Queryable = getDb(),
): Promise<boolean> {
  if (!orgId) return false;
  const invites = await listPendingWorkspaceInvites(rawEmail, db);
  return invites.some((invite) => invite.orgId === orgId);
}
