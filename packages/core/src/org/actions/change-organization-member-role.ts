import { z } from "zod";

import { defineAction } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import { requireOrgMember } from "../actions.js";

export default defineAction({
  requiresSignedInBrowser: true,
  description:
    "Change an organization member's role between member and admin. Every call needs the user's approval. Only owners can grant or remove admin, admins can manage only members, and the owner's role cannot change. Use list-organization-members to find the member.",
  schema: z.object({
    email: z.string().trim().email(),
    role: z.enum(["member", "admin"]),
  }),
  needsApproval: true,
  allowPersistentApproval: false,
  toolCallable: false,
  outputSchema: z.object({
    email: z.string(),
    role: z.enum(["member", "admin"]),
    previousRole: z.enum(["owner", "admin", "member"]),
  }),
  audit: orgAdminAudit({
    targetType: "org-member-role",
    targetId: (_args, result) => (result as { email: string }).email,
    summary: (_args, result) => {
      const r = result as { email: string; previousRole: string; role: string };
      return `Changed ${r.email} from ${r.previousRole} to ${r.role}`;
    },
  }),
  run: async ({ email, role }, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    const { changeOrgMemberRole } = await import("../handlers.js");
    return changeOrgMemberRole(caller, email, role);
  },
});
