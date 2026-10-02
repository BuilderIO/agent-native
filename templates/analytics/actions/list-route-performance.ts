import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  listRoutePerformance,
  ROUTE_PERFORMANCE_MAX_LIMIT,
} from "../server/lib/session-performance.js";
import { assertSessionsTriageLabEnabled } from "../server/lib/sessions-triage-lab.js";
import { sessionEventBoundSchema } from "../shared/session-events.js";

export default defineAction({
  description:
    "List page routes (React Router templates such as /sessions/:id) with p50 and p95 of TTFB, LCP, INP, CLS, and action request duration, plus the count of requests of 1 s or more, from Analytics' own daily histograms. Percentiles are interpolated inside fixed buckets (within about 28% of the exact value); request counts are scaled by their sampling. A metric with no samples is null, which means no data, not fast. Returns the busiest routes first, coverageStartedAt (null when nothing is measured yet), and incompleteDates whose aggregates missed some events. Ranges cover whole UTC days, at most 90. Requires the Sessions triage Lab.",
  schema: z.object({
    from: sessionEventBoundSchema
      .optional()
      .describe(
        "Inclusive first UTC day as an ISO date or a timestamp with an offset; defaults to 6 days before to",
      ),
    to: sessionEventBoundSchema
      .optional()
      .describe(
        "Inclusive last UTC day as an ISO date or a timestamp with an offset; defaults to today",
      ),
    app: z.string().optional().describe("Optional app filter"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ROUTE_PERFORMANCE_MAX_LIMIT)
      .optional()
      .describe("Most routes to return, busiest first; defaults to 50"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("no authenticated user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || null;
    await assertSessionsTriageLabEnabled(userEmail, orgId);
    return listRoutePerformance({ userEmail, orgId }, args);
  },
});
