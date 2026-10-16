import { z } from "zod";

import { defineAction } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import { getDbExec } from "../../db/client.js";
import { requireOrgMember } from "../actions.js";
import { inviteOne } from "../handlers.js";

export default defineAction({
  description:
    "Invite one person to the active organization as a member and email them the invitation. Every call needs the user's approval. Only organization owners and admins may invite. Admin invitations are sent from Settings > Members.",
  schema: z.object({ email: z.string().trim().email() }),
  // The invitation email reaches a real person, so a saved "always allow"
  // must not let an agent send the next one unseen.
  needsApproval: true,
  allowPersistentApproval: false,
  toolCallable: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  audit: orgAdminAudit({
    targetType: "org-invitation",
    targetId: (args) => args.email.toLowerCase(),
    summary: (args) => `Invited ${args.email.toLowerCase()} as member`,
  }),
  run: async ({ email }, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    const { rows } = await getDbExec().execute({
      sql: `SELECT name FROM organizations WHERE id = ? LIMIT 1`,
      args: [caller.orgId],
    });
    const orgName = rows[0]?.name ? String(rows[0].name) : null;
    return inviteOne(
      { orgId: caller.orgId, orgName, email: caller.email },
      email,
      "member",
    );
  },
});
