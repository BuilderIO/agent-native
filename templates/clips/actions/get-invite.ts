/**
 * Look up an invite by its token.
 *
 * Used by the /invite/<token> accept page to show the workspace name, the
 * inviter, and the role — before the user clicks Accept.
 *
 * Usage:
 *   pnpm action get-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Fetch a workspace invite by its token. Returns the invite row plus the workspace's name + brand color. The frontend uses this on the /invite/<token> page to show who invited you and to which workspace.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, args.token));
    if (!invite) {
      return { invite: null, error: "Invite not found." };
    }
    if (invite.acceptedAt) {
      return { invite: null, error: "This invite has already been accepted." };
    }
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      return { invite: null, error: "This invite has expired." };
    }
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, invite.workspaceId));
    if (!ws) {
      return { invite: null, error: "Workspace no longer exists." };
    }
    return {
      invite: {
        id: invite.id,
        workspaceId: invite.workspaceId,
        workspaceName: ws.name,
        workspaceBrandColor: ws.brandColor,
        email: invite.email,
        role: invite.role,
        invitedBy: invite.invitedBy,
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
      },
    };
  },
});
