/**
 * Accept a workspace invite. Marks the invite accepted, inserts a
 * workspace_members row, and switches the UI to the new workspace.
 *
 * Usage:
 *   pnpm action accept-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { writeAppState, readAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Accept a workspace invite. Adds the current user to workspace_members with the invited role, marks the invite accepted, and switches the UI to the new workspace.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const me = getCurrentOwnerEmail();

    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, args.token))
      .limit(1);
    if (!invite) throw new Error("Invite not found.");
    if (invite.acceptedAt) throw new Error("Invite already accepted.");
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      throw new Error("Invite has expired.");
    }

    const now = new Date().toISOString();

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
      .where(eq(schema.workspaces.id, invite.workspaceId))
      .limit(1);
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

void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
