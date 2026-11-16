import { createError } from "h3";
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
    expectedUserEmail: z.string().email().optional(),
    expectedOrgId: z.string().min(1).optional(),
    onboardingRole: onboardingRoleSchema
      .nullable()
      .optional()
      .describe("The user's shared onboarding role preference, or null."),
  }),
  run: async (
    { name, onboardingRole, expectedUserEmail, expectedOrgId },
    ctx,
  ): Promise<UserProfile> => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    if (
      (expectedUserEmail !== undefined &&
        expectedUserEmail.trim().toLowerCase() !==
          ctx.userEmail.trim().toLowerCase()) ||
      (expectedOrgId !== undefined && expectedOrgId !== ctx.orgId)
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: "Profile context changed. Reload before saving.",
      });
    }
    return onboardingRole === undefined
      ? updateUserProfile(ctx.userEmail, name)
      : updateUserProfile(ctx.userEmail, name, onboardingRole);
  },
});
