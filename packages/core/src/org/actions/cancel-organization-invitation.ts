import { z } from "zod";

import { defineAction } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import { requireOrgMember } from "../actions.js";

export default defineAction({
  requiresSignedInBrowser: true,
  description:
    "Cancel a pending invitation to the active organization so it can no longer be accepted. Only organization owners and admins may cancel. Use list-organization-members (pendingInvitations) to find the invitation id.",
  schema: z.object({ invitationId: z.string().trim().min(1) }),
  needsApproval: true,
  allowPersistentApproval: false,
  toolCallable: false,
  audit: orgAdminAudit({
    targetType: "org-invitation",
    targetId: (args) => args.invitationId,
    summary: (args) => `Canceled invitation ${args.invitationId}`,
  }),
  run: async ({ invitationId }, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    const { cancelOrgInvitation } = await import("../handlers.js");
    return cancelOrgInvitation(caller, invitationId);
  },
});
