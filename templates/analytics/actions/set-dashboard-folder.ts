import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { assignDashboardToFolder } from "../server/lib/dashboard-folders-store";

export default defineAction({
  description: "Assign or remove a dashboard's folder membership.",
  schema: z.object({
    dashboardId: z.string(),
    folderId: z.string().nullable(),
  }),
  http: { method: "POST" },
  run: async ({ dashboardId, folderId }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const dashboard = await assignDashboardToFolder(dashboardId, folderId, {
      email,
      orgId: getRequestOrgId() || null,
    });
    return { id: dashboard.id, folderId };
  },
});
