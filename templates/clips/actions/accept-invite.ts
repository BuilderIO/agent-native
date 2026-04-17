/**
 * Accept a workspace invite.
 *
 * Creates a workspace_members row for the current user and marks the invite
 * as accepted. Sets the workspace as the active one via application state.
 *
 * Usage:
 *   pnpm action accept-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Accept a workspace invite. Adds the current user to workspace_members with the invited role, marks the invite as accepted, and switches the UI to the new workspace.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token"),
  }),
  run: async (args) => {
    const db = getDb();
    const me = getCurrentOwnerEmail();

    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, args.token));
    if (!invite) throw new Error("Invite not found.");
    if (invite.acceptedAt) throw new Error("Invite already accepted.");
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      throw new Error("Invite has expired.");
    }

    const now = new Date().toISOString();

    // Avoid duplicate workspace_members rows.
    const [existing] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, invite.workspaceId),
          eq(schema.workspaceMembers.email, me),
        ),
      );
    if (!existing) {
      await db.insert(schema.workspaceMembers).values({
        id: nanoid(),
        workspaceId: invite.workspaceId,
        email: me,
        role: invite.role,
        invitedAt: invite.createdAt,
        joinedAt: now,
      });
    } else if (existing.role !== invite.role) {
      // Keep the higher-privilege role if they already had one.
      const order = ["viewer", "creator-lite", "creator", "admin"];
      const current = order.indexOf(existing.role);
      const next = order.indexOf(invite.role);
      if (next > current) {
        await db
          .update(schema.workspaceMembers)
          .set({ role: invite.role, joinedAt: existing.joinedAt ?? now })
          .where(eq(schema.workspaceMembers.id, existing.id));
      }
    }

    await db
      .update(schema.invites)
      .set({ acceptedAt: now })
      .where(eq(schema.invites.id, invite.id));

    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, invite.workspaceId));
    if (ws) {
      await writeAppState("current-workspace", {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        brandColor: ws.brandColor,
        brandLogoUrl: ws.brandLogoUrl,
      });
    }
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Accepted invite for ${me} into workspace ${invite.workspaceId}`,
    );
    return {
      workspaceId: invite.workspaceId,
      email: me,
      role: invite.role,
    };
  },
});
