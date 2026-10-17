import { z } from "zod";

export const integrationsConfig = z.object({
  durableDispatch: z
    .boolean()
    .optional()
    .meta({
      env: ["AGENT_INTEGRATION_DURABLE_DISPATCH"],
      doc: "Use a durable background function for integration work. Explicit false stops an enabled rollout; unset leaves it unavailable.",
    }),
  allowUnverifiedWebhooks: z
    .boolean()
    .default(false)
    .meta({
      env: ["AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS"],
      doc: "Skip inbound webhook signature verification. Development only — every adapter that reads this treats it as a bypass of sender authentication.",
    }),
  webhookBaseUrl: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["WEBHOOK_BASE_URL"],
      doc: "Optional public base URL for self-callback and webhook targets.",
    }),
  platforms: z
    .array(z.string().min(1))
    .optional()
    .meta({
      env: ["AGENT_NATIVE_INTEGRATION_PLATFORMS"],
      doc: "Integration platforms to mount, comma-separated, each matched against an adapter's `platform` id (slack, telegram, whatsapp, microsoft-teams, discord, google-docs, email). Unset mounts every adapter; a name no adapter provides throws at plugin init.",
    }),
});
