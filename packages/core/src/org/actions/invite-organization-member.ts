import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import { getDbExec } from "../../db/client.js";
import { requireOrgMember } from "../actions.js";
import {
  canRoleInviteInOrg,
  ORG_INVITE_DENIED_MESSAGE,
} from "../invitation-policy.js";

export default defineAction({
  requiresSignedInBrowser: true,
  mcpTool: true,
  description:
    "Invite one person to the active organization as a member and email them the invitation. Every call needs the user's approval. Owners and admins may always invite; plain members may only when this app and workspace allow it. Admin invitations are sent from Settings > Members.",
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
    const caller = await requireOrgMember(ctx);
    if (!(await canRoleInviteInOrg(caller.orgId, caller.role)))
      fail(ORG_INVITE_DENIED_MESSAGE, {
        errorCode: "forbidden",
        statusCode: 403,
      });
    const { rows } = await getDbExec().execute({
      sql: `SELECT name FROM organizations WHERE id = ? LIMIT 1`,
      args: [caller.orgId],
    });
    const orgName = rows[0]?.name ? String(rows[0].name) : null;
    // Loaded on first use: the registry imports every core action module
    // when it is built, and the org route handlers are a heavy graph.
    const { inviteOne } = await import("../handlers.js");
    return inviteOne(
      {
        orgId: caller.orgId,
        orgName,
        email: caller.email,
        role: caller.role,
      },
      email,
      "member",
    );
  },
});
