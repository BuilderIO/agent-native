import { defineAction, fail } from "@agent-native/core/action";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { searchDashboardReferencesPage } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "Search accessible saved SQL or explorer dashboards with the shared Analytics term matcher. Returns searched/of counts, truncation, and a query-bound `nextPage` cursor. Current certified dashboards rank ahead of ordinary references. Use this when the user wants to replicate or adapt an existing dashboard. A returned `certified: true` dashboard is approved for its current saved version. These are references only: inspect a returned dashboard with the getter for its kind before copying it, and do not assume a first-party Analytics dashboard is the authoritative source for a new question.",
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
    nextPage: z
      .string()
      .max(64)
      .optional()
      .describe("Cursor returned by a previous dashboard reference search"),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: ({ result }) => {
    const first =
      result && typeof result === "object" && "results" in result
        ? (result.results as unknown[])[0]
        : null;
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
  run: async ({ search, limit, nextPage }) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail(
        "An authenticated user is required to search dashboard references.",
        {
          errorCode: "authentication_required",
          statusCode: 401,
        },
      );
    }
    return searchDashboardReferencesPage(
      { email, orgId: getRequestOrgId() || null },
      search,
      limit,
      nextPage,
    );
  },
});
