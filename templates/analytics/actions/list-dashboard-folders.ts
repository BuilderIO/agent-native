import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listDashboardFolders } from "../server/lib/dashboard-folders-store";

export default defineAction({
  description: "List dashboard folders accessible to the current user.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
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
