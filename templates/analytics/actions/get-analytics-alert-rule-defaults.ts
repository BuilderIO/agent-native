import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getAnalyticsAlertRuleDefaults } from "../server/lib/analytics-alerts";

export default defineAction({
  description:
    "Read the current user's remembered defaults for creating analytics alert rules.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return getAnalyticsAlertRuleDefaults({ email, orgId });
  },
});
