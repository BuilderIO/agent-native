import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { executeProviderApiRequest } from "../server/lib/provider-api";

const DAY_MS = 24 * 60 * 60 * 1_000;

export default defineAction({
  description:
    "Fetch a bounded Pylon issue corpus through Pylon's server-side search endpoint, or preserve the legacy account/accounts compatibility calls used by generated extensions. Agents should prefer provider-api-request or provider-corpus-job for ad hoc Pylon queries.",
  schema: z.object({
    account: z.string().optional(),
    accounts: z.coerce.boolean().default(false),
    query: z.string().optional(),
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
  run: async ({ account, accounts, query, days, pageSize, maxPages }) => {
    if (accounts) {
      const response = (await executeProviderApiRequest({
        provider: "pylon",
        method: "GET",
        path: "/accounts",
        ...(query?.trim() ? { query: { query: query.trim() } } : {}),
      })) as { response?: { json?: unknown } };
      const body = response.response?.json;
      const values = Array.isArray(body)
        ? body
        : body && typeof body === "object" && "data" in body
          ? Array.isArray((body as { data?: unknown }).data)
            ? (body as { data: unknown[] }).data
            : []
          : [];
      return {
        accounts: values,
        total: values.length,
        source: "pylon-accounts-compatibility",
      };
    }

    if (account?.trim() || query?.trim()) {
      const now = new Date();
      const start = new Date(now.getTime() - 30 * DAY_MS);
      const response = (await executeProviderApiRequest({
        provider: "pylon",
        method: "GET",
        path: "/issues",
        query: {
          ...(account?.trim() ? { account_id: account.trim() } : {}),
          ...(query?.trim() ? { query: query.trim() } : {}),
          start_time: start.toISOString(),
          end_time: now.toISOString(),
        },
      })) as { response?: { json?: unknown } };
      const body = response.response?.json;
      const values = Array.isArray(body)
        ? body
        : body && typeof body === "object" && "data" in body
          ? Array.isArray((body as { data?: unknown }).data)
            ? (body as { data: unknown[] }).data
            : []
          : [];
      return {
        issues: values,
        total: values.length,
        ...(account?.trim() ? { account: account.trim() } : {}),
        source: "pylon-issues-compatibility",
      };
    }

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
