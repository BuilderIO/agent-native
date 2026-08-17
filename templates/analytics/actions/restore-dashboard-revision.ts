import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { queueDashboardCollabSync } from "../server/lib/dashboard-collab-sync";
import { restoreDashboardRevision } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description:
    "Restore a dashboard to a saved history revision, snapshotting the current dashboard first.",
  schema: z.object({
    dashboardId: z.string().describe("Dashboard id to restore"),
    revisionId: z.string().describe("Revision id to restore"),
    expectedUpdatedAt: z
      .string()
      .optional()
      .describe("The dashboard updatedAt value observed before this restore"),
  }),
  http: { method: "POST" },
  run: async (args, actionContext) => {
    const restored = await restoreDashboardRevision(
      args.dashboardId,
      args.revisionId,
      resolveScope(),
      args.expectedUpdatedAt,
    );
    if (!dashboard) {
      throw Object.assign(
        new Error(
          `Dashboard revision "${args.revisionId}" was not found for dashboard "${args.dashboardId}".`,
        ),
        { statusCode: 404 },
      );
    }
    const { dashboard, snapshotRevisionId } = restored;
    queueDashboardCollabSync(
      dashboard.id,
      dashboard.config,
      actionContext?.caller === "frontend" ? undefined : "agent",
    );
    return {
      id: dashboard.id,
      kind: dashboard.kind,
      name: dashboard.title,
      updatedAt: dashboard.updatedAt,
      snapshotRevisionId,
      message: `Restored dashboard "${dashboard.title}" from history.`,
    };
  },
});
