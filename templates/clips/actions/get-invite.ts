/**
 * Look up an invite by its token.
 *
 * The invitation id IS the token — accept URLs point at `/invite/<id>`.
 *
 * Usage:
 *   pnpm action get-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

interface InviteRow {
  id: string;
  org_id: string;
  email: string | null;
  role: string | null;
  status: string | null;
  invited_by: string | null;
  created_at: number | string | null;
  org_name?: string | null;
  brand_color?: string | null;
}

function toIsoIfMs(v: number | string | null): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return new Date(v).toISOString();
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

    const res = await exec.execute({
      sql: `SELECT i.id, i.org_id, i.email, i.role, i.status, i.invited_by, i.created_at,
                  o.name AS org_name,
                  s.brand_color AS brand_color
             FROM org_invitations i
             LEFT JOIN organizations o ON o.id = i.org_id
             LEFT JOIN organization_settings s ON s.organization_id = i.org_id
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

    if (!row.org_name) {
      return { invite: null, error: "Organization no longer exists." };
    }

    return {
      invite: {
        id: row.id,
        organizationId: row.org_id,
        organizationName: row.org_name,
        brandColor: row.brand_color ?? "#18181B",
        email: row.email ?? "",
        role: row.role ?? "member",
        invitedBy: row.invited_by ?? "",
        acceptedAt: status === "accepted" ? toIsoIfMs(row.created_at) : null,
        status,
      },
    };
  },
});
