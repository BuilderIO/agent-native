import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { fetchEmailEngagement } from "../server/lib/email-provider-metrics.js";

export default defineAction({
  description:
    "Read delivered, unique-open and unique-click totals for transactional emails from the email provider, keyed by registered email id. Returns availability separately from the numbers so an unconfigured or failing provider is never reported as zero engagement.",
  schema: z.object({
    templateIds: z
      .array(z.string())
      .describe("Registered email ids to report on."),
    windowDays: z.coerce.number().int().min(1).max(365).default(30),
  }),
  http: { method: "POST" },
  run: async ({ templateIds, windowDays }) =>
    fetchEmailEngagement(templateIds, windowDays),
});
