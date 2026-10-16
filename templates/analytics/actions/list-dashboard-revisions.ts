import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listDashboardRevisionMetadata } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description:
    "List saved dashboard history revisions for undo/restore. Each revision is the dashboard before one save: createdBy and createdAt name that save, and `changes` lists what it changed (changesStatus is `absent` for older revisions, `unreadable` when the stored list is corrupt).",
  schema: z.object({
    dashboardId: z.string().describe("Dashboard id to inspect"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const revisions = await listDashboardRevisionMetadata(
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
        chatContextStatus: revision.chatContextStatus,
        editable: revision.chatContextStatus === "valid",
        ...(revision.chatContext ? { chatContext: revision.chatContext } : {}),
        changesStatus: revision.changesStatus,
        ...(revision.changesStatus === "valid"
          ? {
              changes: revision.changes,
              omittedChanges: revision.omittedChanges,
            }
          : {}),
      })),
    };
  },
});
