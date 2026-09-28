import { z } from "zod";

export const launchDarklyConfig = z.object({
  sdkKey: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["LAUNCHDARKLY_SDK_KEY"],
      doc: "LaunchDarkly server-side SDK key for the active environment. Unset disables LaunchDarkly entirely — every flag read falls back to its caller-supplied default instead of contacting LaunchDarkly.",
    }),
});
