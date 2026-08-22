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
  // Blank counts as unset everywhere in the env layer, so this cannot express
  // "mount no platforms" — refuse the whole slot with `plugins.disabled`
  // instead.
  platforms: z
    .array(z.string().min(1))
    .optional()
    .meta({
      env: ["AGENT_NATIVE_INTEGRATION_PLATFORMS"],
      doc: "Integration platforms to mount, comma-separated, each matched against an adapter's `platform` id (slack, telegram, whatsapp, microsoft-teams, discord, google-docs, email). Unset mounts every adapter; a name no adapter provides throws at plugin init.",
    }),
});
