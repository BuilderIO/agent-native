import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { searchAnalyticsQueryCatalog } from "../server/lib/analytics-query-catalog";

export default defineAction({
  description:
    "Search Analytics' existing query knowledge before writing a new query. This is the analytics equivalent of grepping for similar code: one bounded call searches accessible saved dashboard names, chart titles/descriptions/queries, shipped dashboard patterns, and data-dictionary definitions. Use it first for an ordinary metric lookup unless the user supplied an exact source and query. Prefer the highest-trust close match, adapt its saved query only for the requested filters/time window, run one authoritative source query, and stop on success. Do not separately list every dashboard or scan provider catalogs after a strong match.",
  schema: z.object({
    search: z
      .string()
      .trim()
      .min(2)
      .describe(
        "Focused metric/entity terms from the user's question, for example 'agent native signups' or 'HubSpot closed won revenue'",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .default(6)
      .describe("Maximum ranked candidates to return"),
  }),
  readOnly: true,
  run: async ({ search, limit }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return searchAnalyticsQueryCatalog({
      search,
      limit,
      email,
      orgId: getRequestOrgId() || null,
    });
  },
});
