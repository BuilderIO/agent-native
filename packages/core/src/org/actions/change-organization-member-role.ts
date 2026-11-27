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
  // Admin grants widen who can manage the organization, so a saved
  // "always allow" must not let an agent change the next role unseen.
  needsApproval: true,
  allowPersistentApproval: false,
  toolCallable: false,
  audit: orgAdminAudit({
    targetType: "org-member-role",
    targetId: (_args, result) => (result as { email?: string })?.email,
    summary: (_args, result) => {
      const r = result as { email: string; previousRole: string; role: string };
      return `Changed ${r.email} from ${r.previousRole} to ${r.role}`;
    },
  }),
  run: async ({ email, role }, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    // Loaded on first use: the org route handlers are a heavy graph.
    const { changeOrgMemberRole } = await import("../handlers.js");
    return changeOrgMemberRole(caller, email, role);
  },
});
