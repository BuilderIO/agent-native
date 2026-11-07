import { defineAction, fail } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  analyticsPanelCaptureRequestSchema,
  analyticsPanelCaptureSchema,
} from "@agent-native/core/shared";
import { track } from "@agent-native/core/tracking";

import {
  captureDashboardPanel,
  PanelCaptureError,
} from "../server/lib/panel-capture";

const CAPTURE_BUDGET_MS = 45_000;

export default defineAction({
  description:
    "Read-only. Run one saved dashboard panel as the signed-in user, with the dashboard page's filters and key dates, and return its numbers as labeled rows for another app to keep, such as a chart in a Content page. Also returns who can open the dashboard and a fingerprint that changes when the panel's query or chart settings change. Supports line, area, bar, combo, pie, funnel, metric and table panels.",
  schema: analyticsPanelCaptureRequestSchema,
  outputSchema: analyticsPanelCaptureSchema,
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  timeoutMs: 55_000,
  run: async (args, actionContext) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("Sign in to keep a dashboard panel in a page.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    try {
      const capture = await captureDashboardPanel(args, {
        email,
        orgId: getRequestOrgId() || null,
        timeoutMs: CAPTURE_BUDGET_MS,
        ...(actionContext?.signal ? { signal: actionContext.signal } : {}),
      });
      track(
        "dashboard_panel_captured",
        {
          app_name: "analytics",
          template_name: "analytics",
          panel_type: capture.panel.type,
          row_count: capture.rows.length,
          series_count: capture.series?.length ?? 0,
          truncated: capture.truncated,
          dashboard_visibility: capture.dashboard.visibility,
        },
        actionContext,
      );
      return capture;
    } catch (error) {
      if (error instanceof PanelCaptureError) {
        fail(error.message, {
          errorCode: error.errorCode,
          statusCode: error.statusCode,
        });
      }
      throw error;
    }
  },
});
