import { defineAction } from "@agent-native/core/action";
import { resolveExperienceFlags } from "@agent-native/core/experience-profiles";
import { createGetExperienceProfileAction } from "@agent-native/core/experience-profiles/server";
import { z } from "zod";

import { experienceProfileOptions } from "../server/experience-profile.js";

const selectedProfile = createGetExperienceProfileAction(
  experienceProfileOptions,
);
const profileSchema = z.enum(["reference", "agent-native"]);

export default defineAction({
  description:
    "Read the current user's presentation and deviation flags. This private workspace defaults to the original reference UI for QA; an explicit saved experience choice takes precedence.",
  schema: z.object({}),
  outputSchema: z.object({
    profile: profileSchema,
    savedProfile: profileSchema.nullable(),
    referenceAvailable: z.boolean(),
    values: z.record(z.string(), z.boolean()),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    const state = await selectedProfile.run(args, ctx);
    if (state.savedProfile !== null) return state;
    return {
      ...state,
      profile: "reference" as const,
      values: resolveExperienceFlags(
        experienceProfileOptions.deviations,
        "reference",
      ),
    };
  },
});
