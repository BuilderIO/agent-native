import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { deleteAnalyticsAlertRule } from "../server/lib/analytics-alerts";

export default defineAction({
  description: "Delete a reusable first-party analytics alert rule.",
  schema: z.object({
    id: z.string().describe("Alert rule ID"),
  }),
  http: { method: "POST" },
  run: async ({ id }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    await deleteAnalyticsAlertRule(id, { email, orgId });
    return { ok: true };
  },
});
