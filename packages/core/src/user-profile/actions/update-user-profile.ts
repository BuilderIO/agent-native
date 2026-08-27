import { z } from "zod";

import { defineAction } from "../../action.js";
import { onboardingRoleSchema, type UserProfile } from "../shared.js";
import { updateUserProfile } from "../store.js";

export default defineAction({
  description:
    "Update the current user's display name and optional onboarding role used across Agent-Native apps. Do not change the user's email address with this action.",
  schema: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe(
        "The display name to use when referring to the signed-in user.",
      ),
    onboardingRole: onboardingRoleSchema
      .nullable()
      .optional()
      .describe("The user's shared onboarding role preference, or null."),
  }),
  run: async ({ name, onboardingRole }, ctx): Promise<UserProfile> => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return onboardingRole === undefined
      ? updateUserProfile(ctx.userEmail, name)
      : updateUserProfile(ctx.userEmail, name, onboardingRole);
  },
});
