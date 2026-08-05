import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { fetchEmailActivity } from "../server/lib/email-provider-metrics.js";

export default defineAction({
  description:
    "List recent per-message email activity from the provider (recipient, subject, delivery status, opens, clicks), scoped to one registered email id. The provider's feed has a short retention window, so an empty result does not mean nothing was sent.",
  schema: z.object({
    templateId: z
      .string()
      .min(1)
      .describe("Registered email id to scope the feed to."),
    limit: z.coerce.number().int().min(1).max(1000).default(50),
  }),
  http: { method: "GET" },
  run: async ({ templateId, limit }) =>
    fetchEmailActivity({ templateId, limit }),
});
