/**
 * Look up an invite by its token.
 *
 * The invitation id IS the token — accept URLs point at `/invite/<id>`.
 *
 * Usage:
 *   pnpm action get-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { organizations, orgInvitations } from "@agent-native/core/org";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema as clipsSchema } from "../server/db/index.js";

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
    const [row] = await getDb()
      .select({
        id: orgInvitations.id,
        orgId: orgInvitations.orgId,
        email: orgInvitations.email,
        role: orgInvitations.role,
        status: orgInvitations.status,
        invitedBy: orgInvitations.invitedBy,
        createdAt: orgInvitations.createdAt,
        orgName: organizations.name,
        brandColor: clipsSchema.organizationSettings.brandColor,
      })
      .from(orgInvitations)
      .leftJoin(organizations, eq(organizations.id, orgInvitations.orgId))
      .leftJoin(
        clipsSchema.organizationSettings,
        eq(
          clipsSchema.organizationSettings.organizationId,
          orgInvitations.orgId,
        ),
      )
      .where(eq(orgInvitations.id, args.token))
      .limit(1);
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

    if (!row.orgName) {
      return { invite: null, error: "Organization no longer exists." };
    }

    return {
      invite: {
        id: row.id,
        organizationId: row.orgId,
        organizationName: row.orgName,
        brandColor: row.brandColor ?? "#18181B",
        email: row.email,
        role: row.role ?? "member",
        invitedBy: row.invitedBy,
        acceptedAt: status === "accepted" ? toIsoIfMs(row.createdAt) : null,
        status,
      },
    };
  },
});
