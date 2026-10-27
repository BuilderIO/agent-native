import { defineAction } from "@agent-native/core/action";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  getRequestContext,
  recordFirstRunBuilderCreditsV2Exposure,
} from "@agent-native/core/server";
import { FIRST_RUN_BUILDER_CREDITS_V2_FLAG } from "@agent-native/toolkit/app/onboarding/first-run-builder-credits-flag";
import { z } from "zod";

export default defineAction({
  description:
    "Persist the signed-in user's first-run credits v2 arm after the setup screen is eligible to appear.",
  schema: z.object({}),
  outputSchema: z.object({
    assignment: z
      .object({
        experiment_id: z.string(),
        experiment_variant: z.string(),
      })
      .nullable(),
  }),
  uiOnly: true,
  run: async () => {
    const context = getRequestContext();
    if (!context?.authUserId) return { assignment: null };

    const flagEnabled = await isFeatureFlagEnabled(
      FIRST_RUN_BUILDER_CREDITS_V2_FLAG,
      {
        ...(context.userEmail ? { userEmail: context.userEmail } : {}),
        ...(context.orgId ? { orgId: context.orgId } : {}),
      },
    );
    if (!flagEnabled) return { assignment: null };

    const assignment = await recordFirstRunBuilderCreditsV2Exposure({
      flagEnabled,
    });
    return {
      assignment: assignment
        ? {
            experiment_id: assignment.experiment_id,
            experiment_variant: assignment.experiment_variant,
          }
        : null,
    };
  },
});
