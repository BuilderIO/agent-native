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
import { captureException, track } from "@agent-native/core/tracking";
import { z } from "zod";

import { outsideAgentIdentity } from "../server/lib/bigquery-agent-budget";
import {
  createOutsideAgentBigQueryCall,
  failForOutsideAgentRefusal,
  outsideAgentBigQueryReportSchema,
  outsideAgentCallReportOf,
  outsideAgentRefusalReport,
  reportOutsideAgentBigQueryCall,
  type OutsideAgentBigQueryReport,
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

function captureBudgetReceipt(
  report: OutsideAgentBigQueryReport,
  provisional = false,
) {
  return {
    ...report,
    provisional:
      provisional ||
      report.thisCall.stillReservedUsd > 0 ||
      report.jobs.some((job) => job.state === "reserved"),
  };
}

export default defineAction({
  description:
    "Read-only. Run one saved dashboard panel as the signed-in user, with the dashboard page's filters and key dates, and return its rows with the chart settings the dashboard draws them with, for another app to keep and draw with toolkit's dashboard charts, such as a chart in a Content page. Also returns who can open the dashboard and a fingerprint that changes when the panel's query or chart settings change. Supports line, area, bar, combo, pie, funnel, metric and table panels. Outside agents over MCP/A2A use the existing outside-agent BigQuery budget: daily person and organization allowances and a 50 GB per-job cap, reserved from a dry run before submission. Returns bigQueryBudget with reserved and billed costs; a budget refusal is an error, with its receipt in details.bigQueryBudget. Receipts are point-in-time snapshots; provisional is true while reservations remain unsettled or a timeout/cancellation may still be settling. Do not treat provisional billed amounts as final charges. Caller aborts return query_cancelled (499); do not automatically retry them. An over_job_cap refusal returns 422: narrow the saved filters before trying again; waiting does not change the per-job cap. Cached reads do not start a warehouse job.",
  schema: analyticsPanelCaptureRequestSchema,
  outputSchema: analyticsPanelCaptureSchema.extend({
    bigQueryBudget: outsideAgentBigQueryReportSchema
      .extend({ provisional: z.boolean() })
      .optional(),
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
    let completedBudget: OutsideAgentBigQueryReport | undefined;
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
          throw call.gate.summary().refusal ?? error;
        }
      });
      const { bigQueryBudget: reportedBudget, ...panelCapture } = capture;
      const bigQueryBudget = call
        ? captureBudgetReceipt(reportedBudget ?? (await call.report()))
        : undefined;
      completedBudget = bigQueryBudget;
      const maxChars =
        actionContext?.maxResultChars ??
        resolveToolMaxResultChars({
          maxResultChars: CAPTURE_MAX_RESULT_CHARS,
        });
      const result = bigQueryBudget
        ? {
            ...fitCaptureToChars(
              panelCapture,
              maxChars -
                CAPTURE_RESULT_MARGIN_CHARS -
                JSON.stringify({ bigQueryBudget }, null, 2).length,
            ),
            bigQueryBudget,
          }
        : panelCapture;
      try {
        track(
          "dashboard_panel_captured",
          {
            app_name: "analytics",
            template_name: "analytics",
            panel_type: result.panel.type,
            row_count: result.rows.length,
            column_count: result.columns.length,
            event_count: result.chart.events?.length ?? 0,
            truncated: result.truncated,
            dashboard_visibility: result.dashboard.visibility,
          },
          actionContext,
        );
      } catch (error) {
        if (!call) throw error;
        captureException(error, {
          route: "capture-dashboard-panel",
          tags: { stage: "success_tracking" },
          level: "warning",
          handled: true,
        });
      }
      return result;
    } catch (error) {
      if (error instanceof OutsideAgentBigQueryRefusalError) {
        failForOutsideAgentRefusal(error, {
          bigQueryBudget: captureBudgetReceipt(
            outsideAgentRefusalReport(error),
          ),
        });
      }
      if (error instanceof PanelCaptureError) {
        const cancelled =
          call !== null &&
          error.errorCode === "query_timed_out" &&
          actionContext?.signal?.aborted === true;
        const bigQueryBudget =
          outsideAgentCallReportOf(error) ?? completedBudget;
        fail(cancelled ? "Panel capture was cancelled." : error.message, {
          errorCode: cancelled ? "query_cancelled" : error.errorCode,
          statusCode: cancelled ? 499 : error.statusCode,
          ...(bigQueryBudget
            ? {
                details: {
                  bigQueryBudget: captureBudgetReceipt(
                    bigQueryBudget,
                    error.errorCode === "query_timed_out",
                  ),
                },
              }
            : {}),
        });
      }
      const bigQueryBudget = outsideAgentCallReportOf(error) ?? completedBudget;
      if (bigQueryBudget) {
        captureException(error, {
          route: "capture-dashboard-panel",
          tags: { stage: "capture_result" },
          handled: true,
        });
        fail("This panel could not be captured.", {
          errorCode: "capture_failed",
          statusCode: 500,
          details: { bigQueryBudget: captureBudgetReceipt(bigQueryBudget) },
        });
      }
      throw error;
    }
  },
});
