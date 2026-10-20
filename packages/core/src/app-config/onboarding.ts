import { z } from "zod";

export const onboardingConfig = z.object({
  sharedCompletion: z
    .object({
      enabled: z.boolean().default(false).meta({
        env: "ONBOARDING_SHARED_COMPLETION",
        doc: "Share first-run onboarding completion across sibling apps on the configured parent cookie domain.",
      }),
    })
    .prefault({}),
});
