import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import pylonIssues from "../../../../actions/pylon-issues";
import {
  requireCredential,
  runApiHandlerWithContext,
} from "../../../lib/credentials";
import { executeProviderApiRequest } from "../../../lib/provider-api";

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function responseItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data?: unknown }).data;
    return Array.isArray(data) ? data : [];
  }
  return [];
}

export default defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    const missing = await requireCredential(event, "PYLON_API_KEY", "Pylon");
    if (missing) return missing;
    try {
      const query = getQuery(event);
      const accountId = queryString(query.account_id);
      const state = queryString(query.state);
      const search = queryString(query.query);

      if (accountId || state || search) {
        const now = new Date();
        const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
        const response = (await executeProviderApiRequest({
          provider: "pylon",
          method: "GET",
          path: "/issues",
          query: {
            ...(accountId ? { account_id: accountId } : {}),
            ...(state ? { state } : {}),
            ...(search ? { query: search } : {}),
            start_time: start.toISOString(),
            end_time: now.toISOString(),
          },
        })) as { response?: { json?: unknown } };
        const issues = responseItems(response.response?.json);
        return { issues, total: issues.length };
      }

      const result = await pylonIssues.run({
        days: query.days == null ? 371 : Number(query.days),
        pageSize: 500,
        maxPages: 20,
      });
      return result;
    } catch (error) {
      setResponseStatus(event, 500);
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),
);
