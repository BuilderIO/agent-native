import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";
import { getDashboard } from "../server/lib/dashboards-store";
import { loadDashboardSeed } from "../server/lib/dashboard-seeds";

function seededResponse(
  id: string,
  seed: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    ...seed,
    ownerEmail: null,
    orgId: null,
    visibility: "org",
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
  };
}

function isEmptyConfig(config: Record<string, unknown>): boolean {
  return !Array.isArray(config.panels) || config.panels.length === 0;
}

export default defineAction({
  description:
    "Get a SQL analytics dashboard by ID, including its full panel config, visibility, and access metadata.",
  schema: z.object({
    id: z.string().describe("The dashboard ID"),
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
      if (seed) return seededResponse(args.id, seed);
      throw Object.assign(new Error("Dashboard not found"), {
        statusCode: 404,
      });
    }
    const config = dash.config as Record<string, unknown>;
    if (isEmptyConfig(config)) {
      const seed = loadDashboardSeed(args.id);
      if (seed) return seededResponse(args.id, seed);
    }
    return {
      id: args.id,
      ...config,
      ownerEmail: dash.ownerEmail,
      orgId: dash.orgId,
      visibility: dash.visibility,
      role: dash.role,
      canEdit: dash.canEdit,
      canManage: dash.canManage,
      archivedAt: dash.archivedAt,
      hiddenAt: dash.hiddenAt,
      hiddenBy: dash.hiddenBy,
      createdAt: dash.createdAt,
      updatedAt: dash.updatedAt,
    };
  },
});
