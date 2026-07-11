import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listAnalysisRevisions } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description: "List saved history revisions for an ad-hoc analysis.",
  schema: z.object({
    analysisId: z.string().describe("Analysis id to inspect"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const revisions = await listAnalysisRevisions(
      args.analysisId,
      resolveScope(),
    );
    return {
      revisions: revisions.map((revision) => ({
        id: revision.id,
        analysisId: revision.analysisId,
        name: revision.name,
        description: revision.description,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
      })),
    };
  },
});
