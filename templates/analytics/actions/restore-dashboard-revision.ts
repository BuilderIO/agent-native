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
  withOutsideAgentVerificationBudget,
} from "../server/lib/dashboard-panel-verification";
import {
  getDashboard,
  requireDashboardAccess,
  restoreDashboardRevision,
  type DashboardRecord,
} from "../server/lib/dashboards-store";
import {
  expectedUpdatedAtArg,
  guardWrite,
  idempotencyKeyArg,
} from "../server/lib/guarded-writes";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

const budgetedRun = withOutsideAgentVerificationBudget(
  "restore-dashboard-revision",
);

export default defineAction({
  description:
    "Restore a dashboard to a saved history revision from list-dashboard-revisions, snapshotting the current dashboard first so the restore can itself be undone.",
  schema: z.object({
    dashboardId: z.string().describe("Dashboard id to restore"),
    revisionId: z.string().describe("Revision id to restore"),
    expectedUpdatedAt: expectedUpdatedAtArg("dashboard"),
    idempotencyKey: idempotencyKeyArg,
  }),
  http: { method: "POST" },
  mcpTool: true,
  run: budgetedRun(async (args, actionContext, verificationBudget) => {
    const ctx = resolveScope();
    const guard = guardWrite({
      action: "restore-dashboard-revision",
      target: { kind: "dashboard", id: args.dashboardId },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey: args.idempotencyKey,
      expectedUpdatedAt: args.expectedUpdatedAt,
      request: { revisionId: args.revisionId },
    });
    guard.requireKey();
    guard.requireFence();
    // Read before the restore: the verifier diffs against the config being replaced.
    let before = null as DashboardRecord | null;
    const outcome = await guard.run(
      () => requireDashboardAccess(args.dashboardId, ctx, "editor"),
      async () => {
        before = isAgentCaller(actionContext?.caller)
          ? await getDashboard(args.dashboardId, ctx)
          : null;
        return guard.onCommit
          ? restoreDashboardRevision(
              args.dashboardId,
              args.revisionId,
              ctx,
              args.expectedUpdatedAt,
              guard.onCommit,
            )
          : restoreDashboardRevision(
              args.dashboardId,
              args.revisionId,
              ctx,
              args.expectedUpdatedAt,
            );
      },
    );
    if ("replayed" in outcome) {
      return {
        id: args.dashboardId,
        dashboardId: args.dashboardId,
        ...outcome.replayed,
      };
    }
    const restored = outcome.written;
    if (!restored) {
      throw Object.assign(
        new Error(
          `Dashboard revision "${args.revisionId}" was not found for dashboard "${args.dashboardId}".`,
        ),
        { statusCode: 404 },
      );
    }
    const { dashboard, snapshotRevisionId } = restored;
    void queueDashboardCollabSync(
      dashboard.id,
      dashboard.updatedAt,
      () => getDashboard(dashboard.id, ctx),
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
          budget: verificationBudget,
        });
      } catch (error) {
        verdict = {
          verified: false,
          verification: null,
          proof: [],
          unverified: [],
          nextStep: `REQUIRED: the restore was saved but panel verification failed (${error instanceof Error ? error.message : String(error)}). Call inspect-dashboard-panel on the panels the user cares about before telling them the dashboard renders.`,
          ...(verificationBudget
            ? { bigQueryBudget: await verificationBudget.report() }
            : {}),
        };
      }
    }
    return {
      id: dashboard.id,
      kind: dashboard.kind,
      name: dashboard.title,
      updatedAt: dashboard.updatedAt,
      snapshotRevisionId,
      ...guard.resultFields(dashboard),
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
  }),
});
