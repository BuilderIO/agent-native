import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listDashboardRevisions } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description: "List saved dashboard history revisions for undo/restore.",
  schema: z.object({
    dashboardId: z.string().describe("Dashboard id to inspect"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const revisions = await listDashboardRevisions(
      args.dashboardId,
      resolveScope(),
    );
    return {
      revisions: revisions.map((revision) => ({
        id: revision.id,
        dashboardId: revision.dashboardId,
        kind: revision.kind,
        title: revision.title,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
      })),
    };
  },
});
