import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  buildDashboardAgentContext,
  buildDashboardSeedAgentContext,
} from "../server/lib/agent-readable-resource-context";
import { loadDashboardSeed } from "../server/lib/dashboard-seeds";
import { getDashboard } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "Get a SQL analytics dashboard by ID. By default this returns compact panel summaries and layout/order fields without giant SQL strings; use includeConfig=true only when you need the full dashboard config for a detailed SQL/config edit.",
  schema: z.object({
    id: z.string().describe("The dashboard ID"),
    includeConfig: z
      .boolean()
      .optional()
      .describe(
        "If true, include the full dashboard config including panel SQL. Defaults to false to keep agent context compact.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Dashboard preview",
      description: "Open the dashboard in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open dashboard",
      height: 680,
    }),
  },
  link: ({ result }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : undefined;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: id },
      }),
      label: "Open dashboard in Analytics",
      view: "adhoc",
    };
  },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const ctx = { email, orgId };

    const dash = await getDashboard(args.id, ctx);
    if (!dash || dash.kind !== "sql") {
      const seed = loadDashboardSeed(args.id);
      if (seed)
        return buildDashboardSeedAgentContext(args.id, seed, {
          includeConfig: args.includeConfig === true,
        });
      throw Object.assign(new Error("Dashboard not found"), {
        statusCode: 404,
      });
    }
    return buildDashboardAgentContext(dash, {
      includeConfig: args.includeConfig === true,
    });
  },
});
