import { defineAction } from "@agent-native/core/action";
import {
  getAppConfig,
  getRequestContext,
  recordFirstRunBuilderCreditsV2Exposure,
  resolveFirstRunBuilderCreditsV2Assignment,
} from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Resolve a signed-in user's first-run credits v2 arm and persist exposure after the choice is displayed.",
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

    const config = getAppConfig().onboarding;
    const flagEnabled =
      (config.firstRunCreditsExperimentOverride ??
        config.firstRunCreditsExperiment) === "v2";
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
