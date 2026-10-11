import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { searchAnalyticsQueryCatalog } from "../server/lib/analytics-query-catalog";

export default defineAction({
  description:
    "Search Analytics' existing query knowledge before writing a new query. This bounded search ranks saved dashboard panels, data-dictionary definitions, and imported source-index metadata. Results are references, not live data. Scope compatibility is ranked before certification. The result reports searched/available counts, truncation, and a `nextPage` cursor. Use it for ordinary metric discovery, then inspect live schema if exact columns or current source availability are needed; run one authoritative source query before reporting values.",
  schema: z.object({
    search: z
      .string()
      .trim()
      .min(2)
      .describe(
        "Focused metric/entity terms from the user's question, for example 'agent-native signups' or 'HubSpot closed won revenue'",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .default(6)
      .describe("Maximum ranked candidates to return"),
    nextPage: z
      .string()
      .max(64)
      .optional()
      .describe("Cursor returned by the previous search result"),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({ search, limit, nextPage }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return searchAnalyticsQueryCatalog({
      search,
      limit,
      email,
      orgId: getRequestOrgId() || null,
      nextPage,
    });
  },
});
