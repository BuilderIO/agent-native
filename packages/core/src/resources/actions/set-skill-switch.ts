import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { setSkillSwitch } from "../skill-choices.js";

export default defineAction({
  description:
    "Switch one skill on or off for the current user only. A Required skill stays on whatever they choose, and a Dispatch skill changes in this app only.",
  schema: z.object({
    source: z
      .enum(["personal", "organization", "workspace"])
      .describe(
        'Where the skill lives: "personal", "organization", or "workspace" (from Dispatch).',
      ),
    path: z
      .string()
      .trim()
      .startsWith("skills/")
      .max(512)
      .describe(
        'The skill\'s resource path, such as "skills/brand-voice/SKILL.md".',
      ),
    on: z.boolean().describe("Whether the agent uses it for this user."),
  }),
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ source, path, on }, ctx) => {
    const email = ctx?.userEmail?.trim();
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    const choice = await setSkillSwitch(email, source, path, on);
    return { source, path, ...choice };
  },
});
