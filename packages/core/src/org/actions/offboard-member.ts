import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec } from "../../db/client.js";
import { offboardMember } from "../../identity/offboard.js";
import { requireOrgMember } from "../actions.js";

export default defineAction({
  description:
    "Remove a member from the active organization, transfer their owned rows to an active successor, revoke sessions and app access, and record the offboarding event.",
  schema: z.object({
    email: z.string().email(),
    transferTo: z.string().email(),
  }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  authorize: (_args, ctx) => ctx?.caller === "frontend",
  audit: { enabled: false },
  run: async ({ email, transferTo }, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    const targetEmail = email.trim().toLowerCase();
    const successorEmail = transferTo.trim().toLowerCase();
    const target = await getDbExec().execute({
      sql: `SELECT role, federation_removal_pending_at FROM org_members
            WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [caller.orgId, targetEmail],
    });
    const row = target.rows[0] as
      | { role?: unknown; federation_removal_pending_at?: unknown }
      | undefined;
    if (!row) throw new Error("Member not found in the active organization.");
    if (row.role === "owner")
      throw new Error("Cannot remove the organization owner.");
    if (row.federation_removal_pending_at != null)
      throw new Error("This membership is pending identity-authority cleanup.");
    if (targetEmail === successorEmail)
      throw new Error(
        "A different successor is required when removing a member.",
      );
    const successor = await getDbExec().execute({
      sql: `SELECT 1 FROM org_members
            WHERE org_id = ? AND LOWER(email) = ?
              AND federation_removal_pending_at IS NULL
            LIMIT 1`,
      args: [caller.orgId, successorEmail],
    });
    if (!successor.rows[0])
      throw new Error(
        "Transfer target must be an active member of this organization.",
      );
    return offboardMember(getDbExec(), targetEmail, {
      transferTo: successorEmail,
      orgId: caller.orgId,
      actorEmail: caller.email,
    });
  },
});
