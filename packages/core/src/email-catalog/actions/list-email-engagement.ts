import { z } from "zod";

import { defineAction } from "../../action.js";
import { authorizeTransactionalEmailRead } from "../authorize.js";
import { fetchEmailEngagement } from "../provider-metrics.js";

export default defineAction({
  description:
    "Read provider engagement metrics for registered transactional emails in this app. Organization admin only.",
  schema: z.object({
    templateIds: z.array(z.string().min(1)).max(100),
    windowDays: z.coerce.number().int().min(1).max(365).default(30),
  }),
  http: { method: "POST" },
  authorize: ({ templateIds }) => authorizeTransactionalEmailRead(templateIds),
  run: async ({ templateIds, windowDays }) =>
    fetchEmailEngagement(templateIds, windowDays),
});
