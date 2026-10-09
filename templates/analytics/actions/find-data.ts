import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { searchAnalyticsQueryCatalog } from "../server/lib/analytics-query-catalog.js";

export default defineAction({
  description:
    "Find relevant Analytics data definitions, saved dashboard panels, and imported source-index metadata in one bounded search. Returns ranked reference metadata only, never live values. Within the Analytics app, use `search-bigquery-schema` after this when exact current columns or partition metadata are needed, then run one live source query before reporting data. External MCP callers should use their available provider metadata tools.",
  schema: z.object({
    question: z
      .string()
      .trim()
      .min(2)
      .describe("The metric, entity, event, or data question to investigate"),
    limit: z.number().int().min(1).max(12).optional().default(8),
    nextPage: z
      .string()
      .max(64)
      .optional()
      .describe("Cursor returned by a previous `find-data` result"),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({ question, limit, nextPage }) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("An authenticated user is required to search Analytics data.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const result = await searchAnalyticsQueryCatalog({
      search: question,
      limit,
      nextPage,
      email,
      orgId: getRequestOrgId() || null,
    });
    const { candidates, ...paginationAndCoverage } = result;
    return {
      question,
      results: candidates,
      ...paginationAndCoverage,
      resultType: "reference-metadata",
      guidance:
        "Treat saved SQL and source-index entries as examples or unapproved metadata. Verify source scope, live schema, partitions, and current values before answering. If truncated is true and nextPage is present, continue with that cursor; if truncated is true and nextPage is null, refine the search or use an explicit dashboard/schema search because a source cap was reached.",
    };
  },
});
