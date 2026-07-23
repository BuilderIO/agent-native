import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { restoreAnalysisRevision } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description:
    "Restore an ad-hoc analysis to a saved history revision, snapshotting the current analysis first.",
  schema: z.object({
    analysisId: z.string().describe("Analysis id to restore"),
    revisionId: z.string().describe("Revision id to restore"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const analysis = await restoreAnalysisRevision(
      args.analysisId,
      args.revisionId,
      resolveScope(),
    );
    if (!analysis) {
      throw new Error(
        `Analysis revision "${args.revisionId}" was not found for analysis "${args.analysisId}".`,
      );
    }
    return {
      id: analysis.id,
      name: analysis.name,
      updatedAt: analysis.updatedAt,
      message: `Restored analysis "${analysis.name}" from history.`,
    };
  },
});
