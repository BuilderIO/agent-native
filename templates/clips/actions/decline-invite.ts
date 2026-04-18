/**
 * Decline an organization invite.
 *
 * Marks the invitation as rejected (keeps the row around for audit).
 *
 * Usage:
 *   pnpm action decline-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { z } from "zod";

export default defineAction({
  description:
    "Decline an organization invite. Marks the invitation as rejected so the token can't be reused.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token (invitation id)"),
  }),
  run: async (args) => {
    const exec = getDbExec();
    const pg = isPostgres();

    const res = await exec.execute({
      sql: pg
        ? `SELECT id, organization_id FROM invitation WHERE id = $1 LIMIT 1`
        : `SELECT id, organization_id FROM invitation WHERE id = ? LIMIT 1`,
      args: [args.token],
    });
    const invite = (
      res.rows as Array<{
        id?: string;
        organization_id?: string;
      }>
    )[0];
    if (!invite?.id) {
      return { declined: false, error: "Invite not found." };
    }

    const nowMs = Date.now();
    if (pg) {
      await exec.execute({
        sql: `UPDATE invitation SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
        args: [invite.id],
      });
    } else {
      await exec.execute({
        sql: `UPDATE invitation SET status = 'rejected', updated_at = ? WHERE id = ?`,
        args: [nowMs, invite.id],
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { declined: true, organizationId: invite.organization_id };
  },
});
