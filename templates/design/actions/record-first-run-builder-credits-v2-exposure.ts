import { defineAction } from "@agent-native/core/action";
import {
  evaluateFeatureFlagRules,
  getFeatureFlagRulesStrict,
} from "@agent-native/core/feature-flags";
import {
  getRequestContext,
  recordFirstRunBuilderCreditsV2Exposure,
  resolveFirstRunBuilderCreditsV2Assignment,
} from "@agent-native/core/server";
import { FIRST_RUN_BUILDER_CREDITS_V2_FLAG } from "@agent-native/toolkit/app/onboarding/first-run-builder-credits-flag";
import { z } from "zod";

export default defineAction({
  description:
    "Resolve a signed-in user's first-run credits v2 arm and persist it after the choice is applied.",
  schema: z.object({
    confirmedVariant: z.enum(["control", "credits"]).optional(),
  }),
  outputSchema: z.object({
    assignment: z
      .object({
        experiment_id: z.string(),
        experiment_variant: z.string(),
      })
      .nullable(),
  }),
  uiOnly: true,
  run: async ({ confirmedVariant }) => {
    const context = getRequestContext();
    if (!context?.authUserId) return { assignment: null };

    const flagScope = {
      ...(context.userEmail ? { userEmail: context.userEmail } : {}),
      ...(context.orgId ? { orgId: context.orgId } : {}),
    };
    const flagRules = await getFeatureFlagRulesStrict(
      FIRST_RUN_BUILDER_CREDITS_V2_FLAG.key,
      flagScope,
    );
    const flagEnabled = evaluateFeatureFlagRules(
      FIRST_RUN_BUILDER_CREDITS_V2_FLAG.key,
      flagRules,
      flagScope,
    );
    if (!flagEnabled) return { assignment: null };

    const assignment = confirmedVariant
      ? await recordFirstRunBuilderCreditsV2Exposure({
          flagEnabled,
          experimentVariant: confirmedVariant,
        })
      : await resolveFirstRunBuilderCreditsV2Assignment({ flagEnabled });
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
