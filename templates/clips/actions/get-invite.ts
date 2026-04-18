/**
 * Look up an invite by its token.
 *
 * With better-auth's invitation table, the invitation id IS the token —
 * accept URLs point at `/invite/<invitation.id>`.
 *
 * Usage:
 *   pnpm action get-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { z } from "zod";

interface InviteRow {
  id: string;
  organization_id: string;
  email: string | null;
  role: string | null;
  status: string | null;
  expires_at: string | number | null;
  inviter_id: string | null;
  created_at: string | number | null;
  org_name?: string | null;
  brand_color?: string | null;
  inviter_email?: string | null;
}

function toIsoIfMs(v: string | number | null): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return new Date(v).toISOString();
  // SQLite sometimes returns numeric strings for INTEGER columns.
  const parsed = Number(v);
  if (!Number.isNaN(parsed) && /^\d+$/.test(String(v))) {
    return new Date(parsed).toISOString();
  }
  return v;
}

export default defineAction({
  description:
    "Fetch an organization invite by its token (which is the invitation id). Returns the invitation row plus the organization's name and brand color.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token (invitation id)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const exec = getDbExec();
    const pg = isPostgres();
    const userTable = pg ? `"user"` : `user`;

    const res = await exec.execute({
      sql: pg
        ? `SELECT i.id, i.organization_id, i.email, i.role, i.status, i.expires_at, i.inviter_id, i.created_at,
                  o.name AS org_name,
                  s.brand_color AS brand_color,
                  u.email AS inviter_email
             FROM invitation i
             LEFT JOIN organization o ON o.id = i.organization_id
             LEFT JOIN organization_settings s ON s.organization_id = i.organization_id
             LEFT JOIN ${userTable} u ON u.id = i.inviter_id
             WHERE i.id = $1 LIMIT 1`
        : `SELECT i.id, i.organization_id, i.email, i.role, i.status, i.expires_at, i.inviter_id, i.created_at,
                  o.name AS org_name,
                  s.brand_color AS brand_color,
                  u.email AS inviter_email
             FROM invitation i
             LEFT JOIN organization o ON o.id = i.organization_id
             LEFT JOIN organization_settings s ON s.organization_id = i.organization_id
             LEFT JOIN ${userTable} u ON u.id = i.inviter_id
             WHERE i.id = ? LIMIT 1`,
      args: [args.token],
    });

    const row = (res.rows as InviteRow[])[0];
    if (!row) {
      return { invite: null, error: "Invite not found." };
    }

    const status = row.status ?? "pending";
    if (status === "accepted") {
      return { invite: null, error: "This invite has already been accepted." };
    }
    if (status === "rejected" || status === "canceled") {
      return { invite: null, error: "This invite is no longer valid." };
    }

    const expiresAt = toIsoIfMs(row.expires_at);
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      return { invite: null, error: "This invite has expired." };
    }

    if (!row.org_name) {
      return { invite: null, error: "Organization no longer exists." };
    }

    return {
      invite: {
        id: row.id,
        organizationId: row.organization_id,
        organizationName: row.org_name,
        brandColor: row.brand_color ?? "#18181B",
        email: row.email ?? "",
        role: row.role ?? "member",
        invitedBy: row.inviter_email ?? row.inviter_id ?? "",
        expiresAt,
        acceptedAt: status === "accepted" ? toIsoIfMs(row.created_at) : null,
        status,
      },
    };
  },
});
