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
  let visibleRowNumber = 1;

  return {
    panelCount: panelOrder.length,
    panelOrder,
    firstPanelIds: panelOrder.slice(0, 10),
    groups: groups.map((group) => ({
      key: group.key,
      sectionId: group.section?.id ?? null,
      sectionTitle: group.section?.title ?? null,
      columns: group.columns,
      rows: group.rows.map((row, rowIndex) => {
        const rowNumber = visibleRowNumber++;
        return {
          rowNumber,
          rowIndex,
          panelIds: row.panels.map((panel) => panel.id),
        };
      }),
    })),
  };
}

function panelSummaries(config: Record<string, unknown>) {
  const panels = Array.isArray(config.panels)
    ? (config.panels as Array<Record<string, unknown>>)
    : [];
  return panels.map((panel, index) => {
    const panelConfig =
      panel.config &&
      typeof panel.config === "object" &&
      !Array.isArray(panel.config)
        ? (panel.config as Record<string, unknown>)
        : {};
    return {
      index,
      id: typeof panel.id === "string" ? panel.id : "",
      title: typeof panel.title === "string" ? panel.title : "",
      chartType: typeof panel.chartType === "string" ? panel.chartType : "",
      source: typeof panel.source === "string" ? panel.source : undefined,
      width: typeof panel.width === "number" ? panel.width : undefined,
      columns: typeof panel.columns === "number" ? panel.columns : undefined,
      tab: typeof panel.tab === "string" ? panel.tab : undefined,
      description:
        typeof panelConfig.description === "string"
          ? panelConfig.description
          : undefined,
    };
  });
}

function seededResponse(
  id: string,
  seed: Record<string, unknown>,
  includeConfig: boolean,
): Record<string, unknown> {
  const base = {
    id,
    name: typeof seed.name === "string" ? seed.name : id,
    description:
      typeof seed.description === "string" ? seed.description : undefined,
    filters: seed.filters,
    variables: seed.variables,
    columns: seed.columns,
    panels: panelSummaries(seed),
    layout: dashboardLayoutSummary(seed),
    ownerEmail: null,
    orgId: null,
    visibility: "org",
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
  };
  return includeConfig ? { ...base, ...seed } : base;
}

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
        return seededResponse(args.id, seed, args.includeConfig === true);
      throw Object.assign(new Error("Dashboard not found"), {
        statusCode: 404,
      });
    }
    const config = dash.config as Record<string, unknown>;
    const base = {
      id: args.id,
      name: typeof config.name === "string" ? config.name : args.id,
      description:
        typeof config.description === "string" ? config.description : undefined,
      filters: config.filters,
      variables: config.variables,
      columns: config.columns,
      panels: panelSummaries(config),
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
    return args.includeConfig === true ? { ...base, ...config } : base;
  },
});
