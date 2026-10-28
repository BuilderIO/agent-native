import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listDashboardFolders } from "../server/lib/dashboard-folders-store";

export default defineAction({
  description:
    "List the dashboard folders the current user can access. Use list-sql-dashboards to list the dashboards themselves.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return {
      folders: await listDashboardFolders({
        email,
        orgId: getRequestOrgId() || null,
      }),
    };
  },
});
