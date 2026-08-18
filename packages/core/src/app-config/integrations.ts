import { z } from "zod";

/** Inbound integration webhook policy. */
export const integrationsConfig = z.object({
  allowUnverifiedWebhooks: z
    .boolean()
    .default(false)
    .meta({
      env: ["AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS"],
      doc: "Skip inbound webhook signature verification. Development only — every adapter that reads this treats it as a bypass of sender authentication.",
    }),
});
