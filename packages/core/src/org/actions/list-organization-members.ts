import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec } from "../../db/client.js";
import { requireOrgMember } from "../actions.js";

const MAX_PENDING_INVITATIONS = 100;

export default defineAction({
  mcpTool: true,
  description:
    "List members of the active organization with their roles, sorted by email. Owners and admins also get pending invitations.",
  http: { method: "GET" },
  schema: z.object({
    search: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  }),
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ search, limit, offset }, ctx) => {
    const caller = await requireOrgMember(ctx);
    const db = getDbExec();
    const pattern = search
      ? `%${search.toLowerCase().replace(/[!%_]/g, "!$&")}%`
      : null;
    const { rows } = await db.execute({
      sql: `SELECT email, role, joined_at AS "joinedAt" FROM org_members
            WHERE org_id = ? AND federation_removal_pending_at IS NULL
            ${pattern ? `AND LOWER(email) LIKE ? ESCAPE '!'` : ""}
            ORDER BY LOWER(email)
            LIMIT ? OFFSET ?`,
      args: pattern
        ? [caller.orgId, pattern, limit + 1, offset]
        : [caller.orgId, limit + 1, offset],
    });
    const members = rows.slice(0, limit).map((row: any) => ({
      email: String(row.email),
      role: String(row.role),
      joinedAt: Number(row.joinedAt ?? row.joined_at),
    }));
    const hasMore = rows.length > limit;

    if (caller.role !== "owner" && caller.role !== "admin") {
      return { members, hasMore, nextOffset: hasMore ? offset + limit : null };
    }
    const invites = await db.execute({
      sql: `SELECT email, role, invited_by AS "invitedBy", created_at AS "createdAt"
            FROM org_invitations
            WHERE org_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [caller.orgId, MAX_PENDING_INVITATIONS + 1],
    });
    return {
      members,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
      pendingInvitations: invites.rows
        .slice(0, MAX_PENDING_INVITATIONS)
        .map((row: any) => ({
          email: String(row.email),
          role: row.role === "admin" ? "admin" : "member",
          invitedBy: String(row.invitedBy ?? row.invited_by),
          createdAt: Number(row.createdAt ?? row.created_at),
        })),
      pendingInvitationsTruncated:
        invites.rows.length > MAX_PENDING_INVITATIONS,
    };
  },
});
