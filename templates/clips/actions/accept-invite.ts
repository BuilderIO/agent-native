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
import { getDbExec } from "@agent-native/core/db";
import { putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";

interface InvitationRow {
  id: string;
  org_id: string;
  email: string | null;
  role: string | null;
  status: string | null;
}

export default defineAction({
  description:
    "Accept an organization invite. Inserts an org_members row for the current user with the invited role, marks the invitation as accepted, and switches the caller into the new org.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token (invitation id)"),
  }),
  run: async (args) => {
    const exec = getDbExec();
    const me = getCurrentOwnerEmail();
    const meLower = me.toLowerCase();

    const inviteRes = await exec.execute({
      sql: `SELECT id, org_id, email, role, status FROM org_invitations WHERE id = ? LIMIT 1`,
      args: [args.token],
    });
    const invite = (inviteRes.rows as InvitationRow[])[0];
    if (!invite) throw new Error("Invite not found.");
    if (invite.status === "accepted")
      throw new Error("Invite already accepted.");
    if (invite.status === "rejected" || invite.status === "canceled")
      throw new Error("Invite is no longer valid.");

    const role: "admin" | "member" =
      invite.role === "admin" ? "admin" : "member";
    const nowMs = Date.now();

    // Skip insert if the user is already a member of this org.
    const existsRes = await exec.execute({
      sql: `SELECT id FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [invite.org_id, meLower],
    });

    if (!(existsRes.rows as any[]).length) {
      await exec.execute({
        sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
        args: [nanoid(), invite.org_id, me, role, nowMs],
      });
    }

    await exec.execute({
      sql: `UPDATE org_invitations SET status = 'accepted' WHERE id = ?`,
      args: [invite.id],
    });

    await putUserSetting(me, "active-org-id", { orgId: invite.org_id });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Accepted invite for ${me} into organization ${invite.org_id}`);
    return {
      organizationId: invite.org_id,
      email: me,
      role,
    };
  },
});
