import { processDueWebhookDeliveries } from "../lib/outbound-webhooks.js";

/** Self-hosted Node keeps a best-effort wake-up loop. Serverless uses the signed processor handoff. */
export default () => {
  if (!process.env.NITRO_PRESET?.startsWith("node")) return;
  const timer = setInterval(() => {
    void processDueWebhookDeliveries().catch((error) =>
      console.error("[slides-webhooks] recovery failed", error),
    );
  }, 60_000);
  timer.unref?.();
};
