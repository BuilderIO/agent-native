import { defineAction } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { interpolate } from "../app/pages/adhoc/sql-dashboard/interpolate";
import {
  isDashboardPanelSource,
  normalizeDashboardPanelQuery,
} from "../server/lib/dashboard-panel-query";
import { resolveAnalyticsPanelSource } from "../server/lib/dashboard-panel-source-resolver";
import { getDashboard } from "../server/lib/dashboards-store";
import { exportDashboardPanelToGoogleSheet } from "../server/lib/google-sheets-export";

type DashboardPanel = {
  id?: unknown;
  title?: unknown;
  sql?: unknown;
  source?: unknown;
  chartType?: unknown;
};

const MAX_EXPORT_ROWS = 10_000;
const MAX_EXPORT_CELLS = 500_000;

function asPanels(config: Record<string, unknown>): DashboardPanel[] {
  return Array.isArray(config.panels)
    ? config.panels.filter(
        (panel): panel is DashboardPanel =>
          Boolean(panel) && typeof panel === "object" && !Array.isArray(panel),
      )
    : [];
}

function missingKeyMessage(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const value = result as { error?: unknown; message?: unknown };
  return value.error === "missing_api_key" && typeof value.message === "string"
    ? value.message
    : null;
}

export default defineAction({
  description:
    "Export one accessible Analytics SQL dashboard table panel's underlying query results to a newly created Google Sheet using the connected Google Drive account. Returns the Sheet URL, spreadsheet id, row count, and export metadata. Only chartType=table panels are supported.",
  schema: z.object({
    dashboardId: z.string().trim().min(1).describe("The SQL dashboard ID"),
    panelId: z.string().trim().min(1).describe("The table panel ID"),
    filters: z.record(z.string(), z.string()).optional().default({}),
  }),
  http: { method: "POST" },
  needsApproval: true,
  toolCallable: false,
  run: async ({ dashboardId, panelId, filters }) => {
    const context = getCredentialContext();
    if (!context) {
      throw new Error(
        "No authenticated context for export-dashboard-panel-to-google-sheet.",
      );
    }

    const dashboard = await getDashboard(dashboardId, {
      email: context.userEmail,
      orgId: context.orgId ?? null,
    });
    if (!dashboard || dashboard.kind !== "sql") {
      throw Object.assign(new Error("Dashboard not found"), {
        statusCode: 404,
      });
    }

    const panel = asPanels(dashboard.config).find(
      (candidate) => candidate.id === panelId,
    );
    if (!panel) {
      throw Object.assign(new Error("Dashboard panel not found"), {
        statusCode: 404,
      });
    }
    if (panel.chartType !== "table") {
      throw new Error("Only table dashboard panels can be exported.");
    }
    if (!isDashboardPanelSource(panel.source)) {
      throw new Error("Dashboard panel has an unsupported data source.");
    }
    if (typeof panel.sql !== "string" && typeof panel.sql !== "object") {
      throw new Error("Dashboard panel has no query to export.");
    }

    const rawQuery =
      typeof panel.sql === "string"
        ? interpolate(panel.sql, filters, { failClosedTimeVariables: true })
        : panel.sql;
    const query = normalizeDashboardPanelQuery(panel.source, rawQuery);
    const result = await resolveAnalyticsPanelSource(
      { source: panel.source, query },
      context,
    );
    const missing = missingKeyMessage(result);
    if (missing) throw new Error(missing);
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      !("rows" in result) ||
      !Array.isArray(result.rows)
    ) {
      throw new Error("Dashboard panel query returned an invalid result.");
    }
    const queryResult = result;
    const columnCount = Array.isArray(queryResult.schema)
      ? queryResult.schema.length
      : Object.keys(queryResult.rows[0] ?? {}).length;
    if (queryResult.rows.length > MAX_EXPORT_ROWS) {
      throw new Error(
        `This panel returned more than ${MAX_EXPORT_ROWS.toLocaleString()} rows. Narrow the dashboard filters before exporting.`,
      );
    }
    if (queryResult.rows.length * columnCount > MAX_EXPORT_CELLS) {
      throw new Error(
        "This panel result is too wide to export safely. Narrow the query or reduce its columns.",
      );
    }

    return exportDashboardPanelToGoogleSheet({
      dashboardId,
      dashboardTitle:
        typeof dashboard.title === "string" && dashboard.title.trim()
          ? dashboard.title
          : "Analytics dashboard",
      panelId,
      panelTitle:
        typeof panel.title === "string" && panel.title.trim()
          ? panel.title
          : panelId,
      source: panel.source,
      rows: queryResult.rows,
      schema: Array.isArray(queryResult.schema) ? queryResult.schema : [],
      truncated: queryResult.truncated,
      bytesProcessed: queryResult.bytesProcessed,
    });
  },
});
