import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { listImplementationBlockers } from "../server/lib/implementation-blockers-store";

export default defineAction({
  description:
    "List the curated Implementation Blockers for the current org. This is the source of truth for the Implementation Blockers dashboard — the blocker details live only in the database, never in source. Returns each blocker's company, type, status, summary, and details.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: () => ({
    url: buildDeepLink({
      app: "analytics",
      view: "adhoc",
      params: { dashboardId: "implementation-blockers" },
    }),
    label: "Open Implementation Blockers",
    view: "adhoc",
  }),
  run: async () => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const blockers = await listImplementationBlockers({ email, orgId });
    return { count: blockers.length, blockers };
  },
});
