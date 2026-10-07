import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { dashboardWriteReceipt } from "../server/lib/dashboard-agent-write";
import { queueDashboardCollabSync } from "../server/lib/dashboard-collab-sync";
import {
  annotateSummary,
  isAgentCaller,
  verdictFields,
  verifyPanelWrite,
  type PanelWriteVerdict,
} from "../server/lib/dashboard-panel-verification";
import {
  getDashboard,
  restoreDashboardRevision,
} from "../server/lib/dashboards-store";

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
    const scope = resolveScope();
    // Read before the restore: the verifier diffs against the config being replaced.
    const before = isAgentCaller(actionContext?.caller)
      ? await getDashboard(args.dashboardId, scope)
      : null;
    const restored = await restoreDashboardRevision(
      args.dashboardId,
      args.revisionId,
      scope,
      args.expectedUpdatedAt,
    );
    if (!restored) {
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
    // A restore is the recovery path and is already saved here, so it reports
    // what no longer renders, or that it could not check, instead of refusing.
    let verdict: PanelWriteVerdict | null = null;
    if (isAgentCaller(actionContext?.caller) && dashboard.kind === "sql") {
      try {
        verdict = await verifyPanelWrite({
          base: before?.kind === "sql" ? before.config : null,
          next: dashboard.config,
          signal: actionContext?.signal,
          mode: "report",
          dashboardId: args.dashboardId,
        });
      } catch (error) {
        verdict = {
          verified: false,
          verification: null,
          proof: [],
          unverified: [],
          nextStep: `REQUIRED: the restore was saved but panel verification failed (${error instanceof Error ? error.message : String(error)}). Call inspect-dashboard-panel on the panels the user cares about before telling them the dashboard renders.`,
        };
      }
    }
    return {
      id: dashboard.id,
      kind: dashboard.kind,
      name: dashboard.title,
      updatedAt: dashboard.updatedAt,
      snapshotRevisionId,
      ...verdictFields(verdict),
      ...(verdict
        ? {
            _receipt: dashboardWriteReceipt(
              dashboard.id,
              `Restored "${dashboard.id}" from history`,
              verdict,
            ),
          }
        : {}),
      message: annotateSummary(
        `Restored dashboard "${dashboard.title}" from history.`,
        verdict,
      ),
    };
  },
});
