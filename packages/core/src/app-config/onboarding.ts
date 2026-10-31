import { z } from "zod";

export const onboardingConfig = z.object({
  firstRunCreditsExperiment: z.enum(["v1", "v2"]).default("v1"),
  firstRunCreditsExperimentOverride: z.literal("v1").optional().meta({
    env: "FIRST_RUN_CREDITS_EXPERIMENT",
    doc: "Roll back the first-run credits experiment to v1 for this deployment.",
  }),
  sharedCompletion: z
    .object({
      enabled: z.boolean().default(false).meta({
        env: "ONBOARDING_SHARED_COMPLETION",
        doc: "Share first-run onboarding completion across sibling apps on the configured parent cookie domain.",
      }),
    })
    .prefault({}),
});
