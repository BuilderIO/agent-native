/**
 * Decline an organization invite.
 *
 * Marks the invitation as rejected (keeps the row for audit).
 *
 * Usage:
 *   pnpm action decline-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

export default defineAction({
  description:
    "Decline an organization invite. Marks the invitation as rejected so the token can't be reused.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token (invitation id)"),
  }),
  run: async (args) => {
    const exec = getDbExec();

    const res = await exec.execute({
      sql: `SELECT id, org_id FROM org_invitations WHERE id = ? LIMIT 1`,
      args: [args.token],
    });
    const invite = (
      res.rows as Array<{
        id?: string;
        org_id?: string;
      }>
    )[0];
    if (!invite?.id) {
      return { declined: false, error: "Invite not found." };
    }

    await exec.execute({
      sql: `UPDATE org_invitations SET status = 'rejected' WHERE id = ?`,
      args: [invite.id],
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { declined: true, organizationId: invite.org_id };
  },
});
