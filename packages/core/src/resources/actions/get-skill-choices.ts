import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { readOrgMemberRole } from "../../server/personal-provider-key-policy.js";
import { readSkillChoices } from "../skill-choices.js";

export default defineAction({
  description:
    "Return the current user's skill switches and their organization's skill marks (Recommended, Optional, Required), and whether they can change the marks.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail?.trim();
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    const orgId = ctx?.orgId?.trim() || null;
    const [choices, role] = await Promise.all([
      readSkillChoices({ email, orgId }),
      orgId ? readOrgMemberRole(orgId, email) : null,
    ]);
    return { ...choices, canMark: role === "owner" || role === "admin" };
  },
});
