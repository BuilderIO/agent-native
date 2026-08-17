import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { createDashboardFolder } from "../server/lib/dashboard-folders-store";

export default defineAction({
  description: "Create a personal or shared dashboard folder.",
  schema: z.object({
    name: z.string().min(1).max(120),
    scope: z.enum(["personal", "shared"]),
  }),
  http: { method: "POST" },
  run: async ({ name, scope }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return {
      folder: await createDashboardFolder(name, scope, {
        email,
        orgId: getRequestOrgId() || null,
      }),
    };
  },
});
