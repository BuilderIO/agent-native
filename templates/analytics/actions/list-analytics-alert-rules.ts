import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listAnalyticsAlertRules } from "../server/lib/analytics-alerts";

export default defineAction({
  description: "List reusable alert rules over first-party analytics events.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return listAnalyticsAlertRules({ email, orgId });
  },
});
