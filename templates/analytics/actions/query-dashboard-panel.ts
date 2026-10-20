import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { BigQueryMaximumBytesBilledError } from "../server/lib/bigquery";
import {
  DASHBOARD_PANEL_SOURCES,
  normalizeDashboardPanelQuery,
} from "../server/lib/dashboard-panel-query";
import { resolveAnalyticsPanelSource } from "../server/lib/dashboard-panel-source-resolver";
import {
  BREAKDOWN_OVER_BYTE_CAP_ERROR,
  ROW_BREAKDOWN_MAX_BYTES_BILLED,
} from "../shared/row-breakdown";

export default defineAction({
  description:
    "Run one saved Analytics dashboard panel query through its configured source. This is a UI-only dashboard rendering action.",
  schema: z.object({
    source: z.enum(DASHBOARD_PANEL_SOURCES),
    query: z.unknown(),
    forceRefresh: z.boolean().optional(),
    // Interaction budgets are fixed here. The normal SQL operation retains its
    // source budget; purpose is not an authorization boundary for arbitrary SQL.
    purpose: z.enum(["row-breakdown", "panel-drilldown"]).optional(),
  }),
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  grounding: true,
  run: async (args, actionContext?: ActionRunContext) => {
    const context = getCredentialContext();
    if (!context) {
      throw new Error("No authenticated context for query-dashboard-panel.");
    }

    const query = normalizeDashboardPanelQuery(args.source, args.query);
    const breakdown = args.purpose === "row-breakdown";
    try {
      return await resolveAnalyticsPanelSource(
        {
          source: args.source,
          query,
          ...(args.forceRefresh ? { forceRefresh: true } : {}),
          ...(actionContext?.signal ? { signal: actionContext.signal } : {}),
          ...(args.purpose
            ? { maxBytesBilled: ROW_BREAKDOWN_MAX_BYTES_BILLED }
            : {}),
        },
        context,
      );
    } catch (error) {
      if (breakdown && error instanceof BigQueryMaximumBytesBilledError) {
        return {
          error: BREAKDOWN_OVER_BYTE_CAP_ERROR,
          message: `This breakdown would read more than ${ROW_BREAKDOWN_MAX_BYTES_BILLED / 1024 ** 3} GiB, so it did not run. Narrow the dashboard filters or the panel's date range and try again.`,
        };
      }
      throw error;
    }
  },
});
