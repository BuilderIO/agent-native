import { z } from "zod";

import { defineAction } from "../../action.js";
import { requireOrgMember } from "../../org/actions.js";
import { readSkillChoiceCounts } from "../skill-choices.js";

export default defineAction({
  description:
    "For organization admins: how many members switched each shared skill off or on, and how many keep their own version of it. Counts only, never names.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const { orgId } = await requireOrgMember(ctx, true);
    return readSkillChoiceCounts(orgId);
  },
});
