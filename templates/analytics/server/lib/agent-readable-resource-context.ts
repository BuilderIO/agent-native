import { getPanelOrder } from "../../actions/dashboard-panel-order.js";
import { buildDashboardPanelGroups } from "../../app/pages/adhoc/sql-dashboard/dashboard-layout";
import {
  clampDashboardColumns,
  type SqlPanel,
} from "../../app/pages/adhoc/sql-dashboard/types";
import type { AnalysisRecord, DashboardRecord } from "./dashboards-store.js";

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

export function buildDashboardAgentContext(
  dashboard: DashboardRecord,
  options: { includeConfig?: boolean } = {},
): Record<string, unknown> {
  const config = dashboard.config as Record<string, unknown>;
  const base = {
    resourceType: "analytics-dashboard",
    id: dashboard.id,
    kind: dashboard.kind,
    name: typeof config.name === "string" ? config.name : dashboard.title,
    title: dashboard.title,
    description:
      typeof config.description === "string" ? config.description : undefined,
    filters: config.filters,
    variables: config.variables,
    columns: config.columns,
    panels: panelSummaries(config),
    layout: dashboardLayoutSummary(config),
    ownerEmail: dashboard.ownerEmail,
    orgId: dashboard.orgId,
    visibility: dashboard.visibility,
    role: dashboard.role,
    canEdit: dashboard.canEdit,
    canManage: dashboard.canManage,
    archivedAt: dashboard.archivedAt,
    hiddenAt: dashboard.hiddenAt,
    hiddenBy: dashboard.hiddenBy,
    createdAt: dashboard.createdAt,
    updatedAt: dashboard.updatedAt,
    url: `/dashboards/${dashboard.id}`,
  };
  return options.includeConfig === false ? base : { ...base, ...config };
}

export function buildDashboardSeedAgentContext(
  id: string,
  seed: Record<string, unknown>,
  options: { includeConfig?: boolean } = {},
): Record<string, unknown> {
  const base = {
    resourceType: "analytics-dashboard",
    id,
    kind: "sql",
    name: typeof seed.name === "string" ? seed.name : id,
    title: typeof seed.name === "string" ? seed.name : id,
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
    url: `/dashboards/${id}`,
  };
  return options.includeConfig === false ? base : { ...base, ...seed };
}

export function buildAnalysisAgentContext(
  analysis: AnalysisRecord,
): Record<string, unknown> {
  return {
    resourceType: "analytics-analysis",
    id: analysis.id,
    name: analysis.name,
    description: analysis.description,
    question: analysis.question,
    instructions: analysis.instructions,
    dataSources: analysis.dataSources,
    resultMarkdown: analysis.resultMarkdown,
    resultData: analysis.resultData,
    author: analysis.author,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    ownerEmail: analysis.ownerEmail,
    orgId: analysis.orgId,
    visibility: analysis.visibility,
    role: analysis.role,
    canEdit: analysis.canEdit,
    canManage: analysis.canManage,
    hiddenAt: analysis.hiddenAt,
    hiddenBy: analysis.hiddenBy,
    url: `/analyses/${analysis.id}`,
  };
}
