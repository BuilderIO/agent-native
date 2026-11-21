import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { assignDashboardToFolder } from "../server/lib/dashboard-folders-store";
import { requireDashboardAccess } from "../server/lib/dashboards-store";
import {
  expectedUpdatedAtArg,
  guardWrite,
  idempotencyKeyArg,
} from "../server/lib/guarded-writes";

export default defineAction({
  description:
    "Put a dashboard in a folder, or take it out of its folder with folderId null. A personal folder takes an owned private dashboard; a shared folder takes an org-visible one.",
  schema: z.object({
    dashboardId: z.string(),
    folderId: z
      .string()
      .nullable()
      .describe("The folder to put the dashboard in, or null to unset it."),
    expectedUpdatedAt: expectedUpdatedAtArg("dashboard"),
    idempotencyKey: idempotencyKeyArg,
  }),
  http: { method: "POST" },
  mcpTool: true,
  searchHints: [
    "move a dashboard to a folder",
    "file a dashboard in a folder",
    "organize dashboards",
  ],
  run: async (
    { dashboardId, folderId, expectedUpdatedAt, idempotencyKey },
    actionContext,
  ) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const ctx = { email, orgId: getRequestOrgId() || null };
    const guard = guardWrite({
      action: "set-dashboard-folder",
      target: { kind: "dashboard", id: dashboardId },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey,
      expectedUpdatedAt,
      request: { folderId },
    });
    guard.requireKey();
    guard.requireFence();
    const outcome = await guard.run(
      () => requireDashboardAccess(dashboardId, ctx, "editor"),
      () =>
        guard.active
          ? assignDashboardToFolder(dashboardId, folderId, ctx, guard.store)
          : assignDashboardToFolder(dashboardId, folderId, ctx),
    );
    if ("replayed" in outcome) {
      return { id: dashboardId, folderId, ...outcome.replayed };
    }
    const dashboard = outcome.written;
    return {
      id: dashboard.id,
      folderId,
      ...guard.resultFields(dashboard),
    };
  },
});
