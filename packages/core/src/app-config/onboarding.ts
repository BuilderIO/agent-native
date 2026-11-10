import { z } from "zod";

export const onboardingConfig = z.object({
  builderSignupExperimentId: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .default("design_builder_signup_v1"),
  builderSignupExperiment: z.boolean().default(false),
  builderSignupExperimentOverride: z.boolean().optional().meta({
    env: "BUILDER_SIGNUP_EXPERIMENT",
    doc: "Enable the pre-signup automatic Builder account experiment for this app.",
  }),
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
