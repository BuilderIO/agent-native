import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getFirstPartyAnalyticsBackend } from "../server/lib/first-party-analytics-backend.js";
import { firstPartyAnalyticsTableBackends } from "../server/lib/first-party-analytics.js";

const queryBackendSchema = z.enum(["postgres", "bigquery"]);

export default defineAction({
  description:
    "Report where first-party Analytics queries run for the current user/org, read from its stored backend setting; it never queries BigQuery or any warehouse. Returns `sink` (`postgres`; `dual`, which also writes to BigQuery but reads Postgres; or `bigquery`) and `tables`, the backend each query-agent-native-analytics table is read from. Fails with errorCode first_party_backend_unreadable when the setting cannot be read; that is unknown, not Postgres.",
  schema: z.object({}),
  outputSchema: z.object({
    sink: z.enum(["postgres", "dual", "bigquery"]),
    tables: z.object({
      analytics_events: queryBackendSchema,
      analytics_event_daily_rollups: queryBackendSchema,
      analytics_user_days: queryBackendSchema,
      session_recordings: queryBackendSchema,
    }),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async () => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("no authenticated user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    let sink: Awaited<ReturnType<typeof getFirstPartyAnalyticsBackend>>["sink"];
    try {
      ({ sink } = await getFirstPartyAnalyticsBackend({
        userEmail,
        orgId: getRequestOrgId() || null,
      }));
    } catch (error) {
      console.warn("[first-party-analytics] Backend setting unreadable:", {
        errorType: error instanceof Error ? error.name : "non_error",
      });
      fail(
        "Could not read this scope's first-party analytics backend setting, so it is unknown whether queries would run on Postgres or BigQuery. Do not assume Postgres; retry later.",
        { errorCode: "first_party_backend_unreadable", statusCode: 503 },
      );
    }
    return { sink, tables: firstPartyAnalyticsTableBackends(sink) };
  },
});
