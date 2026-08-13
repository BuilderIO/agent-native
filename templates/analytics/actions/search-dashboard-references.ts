import { defineAction } from "@agent-native/core";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { searchDashboardReferences } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "Find a bounded set of accessible saved SQL dashboards whose id, name, description, or config matches the search text. Use this when the user wants to replicate or adapt an existing dashboard. These are references only: inspect the returned dashboard before copying it, and do not assume a first-party Analytics dashboard is the authoritative source for a new question.",
  schema: z.object({
    search: z
      .string()
      .trim()
      .min(2)
      .describe("Focused dashboard name, metric, provider, or config terms"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(24)
      .optional()
      .default(8)
      .describe("Maximum dashboard references to return"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: ({ result }) => {
    const first = Array.isArray(result) ? result[0] : null;
    const id =
      first && typeof first === "object"
        ? (first as { id?: string }).id
        : undefined;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: id },
      }),
      label: "Open dashboard reference in Analytics",
      view: "adhoc",
    };
  },
  run: async ({ search, limit }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    return searchDashboardReferences(
      { email, orgId: getRequestOrgId() || null },
      search,
      limit,
    );
  },
});
