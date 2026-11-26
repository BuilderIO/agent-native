import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  requireAnalysisAccess,
  restoreAnalysisRevision,
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

export default defineAction({
  description:
    "Restore an ad-hoc analysis to a saved history revision from list-analysis-revisions, snapshotting the current analysis first so the restore can itself be undone.",
  schema: z.object({
    analysisId: z.string().describe("Analysis id to restore"),
    revisionId: z.string().describe("Revision id to restore"),
    expectedUpdatedAt: expectedUpdatedAtArg("analysis"),
    idempotencyKey: idempotencyKeyArg,
  }),
  http: { method: "POST" },
  mcpTool: true,
  run: async (args, actionContext) => {
    const ctx = resolveScope();
    const guard = guardWrite({
      action: "restore-analysis-revision",
      target: { kind: "analysis", id: args.analysisId },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey: args.idempotencyKey,
      expectedUpdatedAt: args.expectedUpdatedAt,
      request: { revisionId: args.revisionId },
    });
    guard.requireKey();
    guard.requireFence();
    const outcome = await guard.run(
      () => requireAnalysisAccess(args.analysisId, ctx, "editor"),
      () =>
        guard.active
          ? restoreAnalysisRevision(
              args.analysisId,
              args.revisionId,
              ctx,
              args.expectedUpdatedAt,
              guard.onCommit,
            )
          : restoreAnalysisRevision(args.analysisId, args.revisionId, ctx),
    );
    if ("replayed" in outcome) {
      return {
        id: args.analysisId,
        analysisId: args.analysisId,
        ...outcome.replayed,
      };
    }
    const analysis = outcome.written;
    if (!analysis) {
      throw Object.assign(
        new Error(
          `Analysis revision "${args.revisionId}" was not found for analysis "${args.analysisId}".`,
        ),
        { statusCode: 404 },
      );
    }
    return {
      id: analysis.id,
      name: analysis.name,
      updatedAt: analysis.updatedAt,
      ...guard.resultFields(analysis),
      message: `Restored analysis "${analysis.name}" from history.`,
    };
  },
});
