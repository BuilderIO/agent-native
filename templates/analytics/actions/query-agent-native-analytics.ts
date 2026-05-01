import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { queryFirstPartyAnalytics } from "../server/lib/first-party-analytics.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Query first-party Agent Native analytics events recorded through analytics.agent-native.com/track. Use this data-source-specific action instead of db-query. SQL may read analytics_events only; reads are automatically scoped to the current user/org.",
  schema: z.object({
    sql: z
      .string()
      .describe(
        "Read-only SQL over analytics_events, e.g. SELECT event_name, COUNT(*) AS count FROM analytics_events GROUP BY event_name",
      ),
  }),
  http: false,
  run: async (args) => {
    return queryFirstPartyAnalytics(args.sql, resolveScope());
  },
});
