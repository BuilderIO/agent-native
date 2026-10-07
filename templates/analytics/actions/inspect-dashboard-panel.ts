import { defineAction, fail } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  describePanelOutcome,
  verifyDashboardPanels,
} from "../server/lib/dashboard-panel-verification";
import { getDashboard } from "../server/lib/dashboards-store";

const INSPECT_BUDGET_MS = 45_000;
const MAX_PANEL_IDS_LISTED = 40;

export default defineAction({
  description:
    "Read-only. Run ONE saved dashboard panel exactly as the dashboard page does (saved SQL, the dashboard's default filters unless `filters` is given, same source resolver and result cache) and return what the viewer sees: whether it shows 'No data', the result columns, configured keys that are missing or ignored, the first rows, the resolved filter values, and the resolved SQL. " +
    "Call it when the user says an edit is not visible and whenever mutate-dashboard, update-dashboard or compose-dashboard returns verified:false. A raw bigquery result or a missing warning banner is not proof; status 'ok' here is.",
  schema: z.object({
    dashboardId: z.string().min(1).describe("Dashboard id."),
    panelId: z.string().min(1).describe("Panel id inside the dashboard."),
    filters: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Filter values keyed by filter id as the page URL carries them, e.g. {timeRange:'30d', app:'mail'}. Omit for the dashboard defaults a fresh tab shows.",
      ),
    sampleRows: z
      .number()
      .int()
      .min(0)
      .max(20)
      .default(5)
      .describe("Result rows to return (max 20; cells are truncated)."),
    forceRefresh: z
      .boolean()
      .optional()
      .describe("Bypass the result cache (BigQuery only), like Refresh."),
  }),
  http: { method: "POST" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  timeoutMs: 55_000,
  run: async (args, actionContext) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("no authenticated user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const dashboard = await getDashboard(args.dashboardId, {
      email,
      orgId: getRequestOrgId() || null,
    });
    if (!dashboard) {
      fail(
        `Dashboard "${args.dashboardId}" was not found, or you don't have access to it.`,
        { errorCode: "dashboard_not_found", statusCode: 404 },
      );
    }
    if (dashboard.kind !== "sql") {
      fail(
        `inspect-dashboard-panel only supports SQL dashboards; "${args.dashboardId}" is ${dashboard.kind}.`,
        { errorCode: "dashboard_not_sql", statusCode: 400 },
      );
    }

    const config = dashboard.config;
    const panels = Array.isArray(config.panels)
      ? (config.panels as Record<string, unknown>[])
      : [];
    const panel = panels.find((candidate) => candidate?.id === args.panelId);
    if (!panel) {
      const ids = panels
        .map((candidate) => candidate?.id)
        .filter((id): id is string => typeof id === "string");
      fail(
        `Panel "${args.panelId}" is not in dashboard "${args.dashboardId}". Panel ids: ${ids.slice(0, MAX_PANEL_IDS_LISTED).join(", ")}${ids.length > MAX_PANEL_IDS_LISTED ? ` (+${ids.length - MAX_PANEL_IDS_LISTED} more)` : ""}.`,
        { errorCode: "panel_not_found", statusCode: 404 },
      );
    }
    if (panel.chartType === "section" || panel.chartType === "extension") {
      fail(
        `Panel "${args.panelId}" is a ${panel.chartType} panel; it has no query to inspect.`,
        { errorCode: "panel_not_queryable", statusCode: 400 },
      );
    }

    const verification = await verifyDashboardPanels(config, [args.panelId], {
      signal: actionContext?.signal,
      filters: args.filters,
      forceRefresh: args.forceRefresh,
      sampleRows: args.sampleRows,
      budgetMs: INSPECT_BUDGET_MS,
      maxBytesToExecute: Infinity,
      dryRun: false,
    });
    const [inspected] = verification.panels;
    return {
      dashboardId: args.dashboardId,
      dashboardUpdatedAt: dashboard.updatedAt,
      filterState: verification.filterState,
      ...inspected,
      config: panel.config ?? null,
      summary: `Panel "${inspected.title}" (${inspected.panelId}) ${describePanelOutcome(inspected)}.`,
    };
  },
});
