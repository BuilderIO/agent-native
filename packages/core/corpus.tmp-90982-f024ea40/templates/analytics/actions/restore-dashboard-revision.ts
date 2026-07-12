import { defineAction } from "@agent-native/core";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { restoreDashboardRevision } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

async function syncToCollab(
  dashboardId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const docId = `dash-${dashboardId}`;
  const configStr = JSON.stringify(config);
  try {
    const exists = await hasCollabState(docId);
    if (exists) {
      await applyText(docId, configStr, "content", "agent");
    } else {
      await seedFromText(docId, configStr);
    }
  } catch {
    // SQL is the source of truth; open editors also refetch on the dashboards signal.
  }
}

export default defineAction({
  description:
    "Restore a dashboard to a saved history revision, snapshotting the current dashboard first.",
  schema: z.object({
    dashboardId: z.string().describe("Dashboard id to restore"),
    revisionId: z.string().describe("Revision id to restore"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const dashboard = await restoreDashboardRevision(
      args.dashboardId,
      args.revisionId,
      resolveScope(),
    );
    if (!dashboard) {
      throw new Error(
        `Dashboard revision "${args.revisionId}" was not found for dashboard "${args.dashboardId}".`,
      );
    }
    await syncToCollab(dashboard.id, dashboard.config);
    return {
      id: dashboard.id,
      kind: dashboard.kind,
      name: dashboard.title,
      updatedAt: dashboard.updatedAt,
      message: `Restored dashboard "${dashboard.title}" from history.`,
    };
  },
});
