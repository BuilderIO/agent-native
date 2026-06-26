import { readBody } from "@agent-native/core/server";
import { defineEventHandler, setResponseStatus } from "h3";

import { runApiHandlerWithContext } from "../lib/credentials";
import {
  isDashboardPanelSource,
  normalizeDashboardPanelQuery,
  runDashboardPanelQuery,
} from "../lib/dashboard-panel-query";

export const handleSqlQuery = defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async (ctx) => {
    const { query: rawQuery, source } = (await readBody(event)) as {
      query?: unknown;
      source?: unknown;
    };

    if (!isDashboardPanelSource(source)) {
      setResponseStatus(event, 400);
      return {
        error:
          "Invalid source. Must be 'bigquery', 'ga4', 'amplitude', 'first-party', 'app', 'demo', or 'prometheus'",
      };
    }

    try {
      const query = normalizeDashboardPanelQuery(source, rawQuery);
      return await runDashboardPanelQuery({ source, query, ctx });
    } catch (error: any) {
      const message = error?.message || String(error);
      console.error(`SQL query error (${source}):`, message);
      setResponseStatus(event, /DB query timed out/i.test(message) ? 504 : 400);
      return { error: message };
    }
  });
});
