import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { buildDashboardPanelGroups } from "../app/pages/adhoc/sql-dashboard/dashboard-layout";
import {
  clampDashboardColumns,
  type SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";
import { loadDashboardSeed } from "../server/lib/dashboard-seeds";
import { getDashboard } from "../server/lib/dashboards-store";
import { getPanelOrder } from "./dashboard-panel-order";

function dashboardLayoutSummary(config: Record<string, unknown>) {
  const panels = Array.isArray(config.panels)
    ? (config.panels as SqlPanel[])
    : [];
  const columns = clampDashboardColumns(config.columns);
  const groups = buildDashboardPanelGroups(panels, columns);
  const panelOrder = getPanelOrder(config);

  return {
    panelCount: panelOrder.length,
    panelOrder,
    firstPanelIds: panelOrder.slice(0, 10),
    groups: groups.map((group) => ({
      key: group.key,
      sectionId: group.section?.id ?? null,
      sectionTitle: group.section?.title ?? null,
      columns: group.columns,
      rows: group.rows.map((row, rowIndex) => ({
        rowIndex,
        panelIds: row.panels.map((panel) => panel.id),
      })),
    })),
  };
}

function seededResponse(
  id: string,
  seed: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    ...seed,
    layout: dashboardLayoutSummary(seed),
    ownerEmail: null,
    orgId: null,
    visibility: "org",
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
  };
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
    return {
      id: args.id,
      ...config,
      layout: dashboardLayoutSummary(config),
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
