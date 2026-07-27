import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { runAnalyticsAlertsOnce } from "../server/jobs/analytics-alerts";

export default defineAction({
  description:
    "Run one alert sweep for the current user's first-party analytics alert rules.",
  schema: z.object({
    limit: z.number().int().min(1).max(500).optional(),
  }),
  http: { method: "POST" },
  run: async ({ limit }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return runAnalyticsAlertsOnce({ ownerEmail: email, orgId, limit });
  },
});
