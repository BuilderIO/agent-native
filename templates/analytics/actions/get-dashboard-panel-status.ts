import { defineAction, fail } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { analyticsPanelStatusRequestSchema } from "@agent-native/core/shared";

import {
  dashboardPanelStatus,
  PanelCaptureError,
} from "../server/lib/panel-capture";

export default defineAction({
  description:
    "Read-only. Who can open a dashboard (invited people, the organization, or anyone with the link) and a fingerprint for each named panel that changes when its query or chart settings change. Runs no query. Another app keeping a panel's numbers uses it to mark a kept copy as changed and to check its readers against the dashboard's.",
  schema: analyticsPanelStatusRequestSchema,
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("Sign in to read a dashboard's sharing.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    try {
      return await dashboardPanelStatus(args, {
        email,
        orgId: getRequestOrgId() || null,
      });
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
