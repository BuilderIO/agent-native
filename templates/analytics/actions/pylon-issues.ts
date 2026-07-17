import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { executeProviderApiRequest } from "../server/lib/provider-api";

const DAY_MS = 24 * 60 * 60 * 1_000;

export default defineAction({
  description:
    "Fetch a bounded Pylon issue corpus through Pylon's server-side search endpoint. This is a thin compatibility/data recipe for dashboards; agents should prefer provider-api-request or provider-corpus-job for ad hoc Pylon queries.",
  schema: z.object({
    days: z.coerce
      .number()
      .int()
      .min(1)
      .max(730)
      .default(371)
      .describe("Created-at lookback window. Defaults to 53 weeks."),
    pageSize: z.coerce.number().int().min(1).max(999).default(500),
    maxPages: z.coerce.number().int().min(1).max(50).default(20),
  }),
  readOnly: true,
  parallelSafe: true,
  agentTool: false,
  toolCallable: true,
  http: { method: "POST" },
  run: async ({ days, pageSize, maxPages }) => {
    const createdAfter = new Date(Date.now() - days * DAY_MS).toISOString();
    const response = (await executeProviderApiRequest({
      provider: "pylon",
      method: "POST",
      path: "/issues/search",
      body: {
        filter: {
          field: "created_at",
          operator: "time_is_after",
          value: createdAfter,
        },
        limit: pageSize,
      },
      fetchAllPages: {
        cursorPath: "pagination.cursor",
        cursorBodyPath: "cursor",
        itemsPath: "data",
        maxPages,
      },
    })) as {
      items?: unknown[];
      pagesRead?: number;
      totalItems?: number;
      lastStatus?: number;
      truncated?: boolean;
      nextCursor?: string | null;
    };
    const issues = Array.isArray(response.items) ? response.items : [];
    const pagesRead = Number(response.pagesRead ?? 0);
    return {
      issues,
      total: Number(response.totalItems ?? issues.length),
      pagesRead,
      createdAfter,
      coverageComplete: response.truncated !== true,
      truncated: response.truncated === true,
      nextCursor: response.nextCursor ?? null,
      source: "pylon-issues-search",
    };
  },
});
