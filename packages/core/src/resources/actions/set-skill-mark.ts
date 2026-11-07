import { z } from "zod";

import { defineAction } from "../../action.js";
import { requireOrgMember } from "../../org/actions.js";
import { setSkillMark, SKILL_MARKS } from "../skill-choices.js";

export default defineAction({
  description:
    "For organization admins: choose how a shared skill starts for everyone. Recommended is on unless someone switches it off, Optional is off unless someone switches it on, and Required is on for everyone, with nobody able to switch it off or use their own version.",
  schema: z.object({
    source: z
      .enum(["organization", "workspace"])
      .describe(
        'Where the skill lives: "organization", or "workspace" (from Dispatch, marked for this app only).',
      ),
    path: z
      .string()
      .trim()
      .startsWith("skills/")
      .max(512)
      .describe(
        'The skill\'s resource path, such as "skills/brand-voice/SKILL.md".',
      ),
    mark: z.enum(SKILL_MARKS).describe("How the skill starts for people."),
  }),
  outputSchema: z.object({
    source: z.enum(["organization", "workspace"]),
    path: z.string(),
    mark: z.enum(SKILL_MARKS),
  }),
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ source, path, mark }, ctx) => {
    const { orgId } = await requireOrgMember(ctx, true);
    await setSkillMark(orgId, source, path, mark);
    return { source, path, mark };
  },
});
