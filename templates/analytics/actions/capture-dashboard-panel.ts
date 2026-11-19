import { defineAction, fail } from "@agent-native/core";
import { resolveToolMaxResultChars } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  analyticsPanelCaptureRequestSchema,
  analyticsPanelCaptureSchema,
} from "@agent-native/core/shared";
import { track } from "@agent-native/core/tracking";

import { outsideAgentIdentity } from "../server/lib/bigquery-agent-budget";
import {
  createOutsideAgentBigQueryCall,
  outsideAgentBigQueryReportSchema,
  outsideAgentCallReportOf,
  outsideAgentRefusalReport,
  reportOutsideAgentBigQueryCall,
} from "../server/lib/bigquery-agent-calls";
import {
  isOutsideAgentCaller,
  OutsideAgentBigQueryRefusalError,
  withOutsideAgentBigQueryGate,
} from "../server/lib/bigquery-agent-context";
import {
  captureDashboardPanel,
  fitCaptureToChars,
  PanelCaptureError,
} from "../server/lib/panel-capture";

const CAPTURE_BUDGET_MS = 45_000;
// Another app reads the whole capture, so it has to fit the result limit.
const CAPTURE_MAX_RESULT_CHARS = 50_000;
// Room for anything the framework adds around the result.
const CAPTURE_RESULT_MARGIN_CHARS = 1_000;

export default defineAction({
  description:
    "Read-only. Run one saved dashboard panel as the signed-in user, with the dashboard page's filters and key dates, and return its rows with the chart settings the dashboard draws them with, for another app to keep and draw with toolkit's dashboard charts, such as a chart in a Content page. Also returns who can open the dashboard and a fingerprint that changes when the panel's query or chart settings change. Supports line, area, bar, combo, pie, funnel, metric and table panels. Outside agents over MCP/A2A use the existing outside-agent BigQuery budget: daily person and organization allowances and a 50 GB per-job cap, reserved from a dry run before submission. Returns bigQueryBudget with reserved and billed costs; a budget refusal is an error, with its receipt in details.bigQueryBudget. Cached reads do not start a warehouse job.",
  schema: analyticsPanelCaptureRequestSchema,
  outputSchema: analyticsPanelCaptureSchema.extend({
    bigQueryBudget: outsideAgentBigQueryReportSchema.optional(),
  }),
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  timeoutMs: 55_000,
  maxResultChars: CAPTURE_MAX_RESULT_CHARS,
  run: async (args, actionContext) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("Sign in to keep a dashboard panel in a page.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || null;
    const call = isOutsideAgentCaller(actionContext?.caller)
      ? createOutsideAgentBigQueryCall({
          identity: outsideAgentIdentity(email, orgId),
          source: "capture-dashboard-panel",
          reservation: "dry-run",
          leaseMs: CAPTURE_BUDGET_MS + 60_000,
        })
      : null;
    try {
      const capturePanel = () =>
        captureDashboardPanel(args, {
          email,
          orgId,
          timeoutMs: CAPTURE_BUDGET_MS,
          maxChars:
            (actionContext?.maxResultChars ??
              resolveToolMaxResultChars({
                maxResultChars: CAPTURE_MAX_RESULT_CHARS,
              })) - CAPTURE_RESULT_MARGIN_CHARS,
          ...(actionContext?.signal ? { signal: actionContext.signal } : {}),
        });
      const capture = await reportOutsideAgentBigQueryCall(call, async () => {
        if (!call) return capturePanel();
        try {
          return await withOutsideAgentBigQueryGate(call.gate, capturePanel);
        } catch (error) {
          // The panel runner renders provider exceptions as panel failures.
          throw call.gate.summary().refusal ?? error;
        }
      });
      track(
        "dashboard_panel_captured",
        {
          app_name: "analytics",
          template_name: "analytics",
          panel_type: capture.panel.type,
          row_count: capture.rows.length,
          column_count: capture.columns.length,
          event_count: capture.chart.events?.length ?? 0,
          truncated: capture.truncated,
          dashboard_visibility: capture.dashboard.visibility,
        },
        actionContext,
      );
      if (!call) return capture;
      const bigQueryBudget = capture.bigQueryBudget ?? (await call.report());
      const { bigQueryBudget: _budget, ...panelCapture } = capture;
      const maxChars =
        actionContext?.maxResultChars ??
        resolveToolMaxResultChars({
          maxResultChars: CAPTURE_MAX_RESULT_CHARS,
        });
      return {
        ...fitCaptureToChars(
          panelCapture,
          maxChars -
            CAPTURE_RESULT_MARGIN_CHARS -
            JSON.stringify({ bigQueryBudget }, null, 2).length,
        ),
        bigQueryBudget,
      };
    } catch (error) {
      if (error instanceof OutsideAgentBigQueryRefusalError) {
        fail(error.message, {
          errorCode: error.code,
          statusCode:
            error.code === "budget_unavailable" ||
            error.code === "estimate_unavailable"
              ? 503
              : error.code === "budget_required"
                ? 403
                : 429,
          details: { bigQueryBudget: outsideAgentRefusalReport(error) },
        });
      }
      if (error instanceof PanelCaptureError) {
        fail(error.message, {
          errorCode: error.errorCode,
          statusCode: error.statusCode,
          ...(outsideAgentCallReportOf(error)
            ? { details: { bigQueryBudget: outsideAgentCallReportOf(error) } }
            : {}),
        });
      }
      throw error;
    }
  },
});
