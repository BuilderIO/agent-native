/**
 * Accept an organization invite.
 *
 * Verifies the invitation is pending, inserts a row into `org_members` for
 * the current user, marks the invitation as accepted, and activates the new
 * org for the caller via the `active-org-id` user-setting.
 *
 * Usage:
 *   pnpm action accept-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { orgInvitations, orgMembers } from "@agent-native/core/org";
import { putUserSetting } from "@agent-native/core/settings";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Accept an organization invite. Inserts an org_members row for the current user with the invited role, marks the invitation as accepted, and switches the caller into the new org.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token (invitation id)"),
  }),
  run: async (args) => {
    const db = getDb();
    const me = getCurrentOwnerEmail();
    const meLower = me.toLowerCase();

    const [invite] = await db
      .select({
        id: orgInvitations.id,
        orgId: orgInvitations.orgId,
        role: orgInvitations.role,
        status: orgInvitations.status,
      })
      .from(orgInvitations)
      .where(eq(orgInvitations.id, args.token))
      .limit(1);
    if (!invite) throw new Error("Invite not found.");
    if (invite.status === "accepted")
      throw new Error("Invite already accepted.");
    if (invite.status === "rejected" || invite.status === "canceled")
      throw new Error("Invite is no longer valid.");

    const role: "admin" | "member" =
      invite.role === "admin" ? "admin" : "member";
    const nowMs = Date.now();

    // Skip insert if the user is already a member of this org.
    const existing = await db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, invite.orgId),
          sql`lower(${orgMembers.email}) = ${meLower}`,
        ),
      )
      .limit(1);

    if (!existing.length) {
      await db.insert(orgMembers).values({
        id: nanoid(),
        orgId: invite.orgId,
        email: me,
        role,
        joinedAt: nowMs,
      });
    }

    await db
      .update(orgInvitations)
      .set({ status: "accepted" })
      .where(eq(orgInvitations.id, invite.id));

    await putUserSetting(me, "active-org-id", { orgId: invite.orgId });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Accepted invite for ${me} into organization ${invite.orgId}`);
    return {
      organizationId: invite.orgId,
      email: me,
      role,
    };
  },
});
