import { createHash } from "node:crypto";

import { getPanelOrder } from "../../actions/dashboard-panel-order.js";
import { buildDashboardPanelGroups } from "../../app/pages/adhoc/sql-dashboard/dashboard-layout";
import {
  clampDashboardColumns,
  type SqlPanel,
} from "../../app/pages/adhoc/sql-dashboard/types";
import { isDashboardCertified } from "./dashboard-certification.js";
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

/** Config keys that name columns of the panel's result set. */
const BINDING_KEYS = [
  "xKey",
  "yKey",
  "yKeys",
  "rightYKeys",
  "barKeys",
  "pivot",
] as const;

/** Largest `includeConfig` result an agent gets before it is told to name panels. */
export const AGENT_FULL_CONFIG_MAX_CHARS = 12_000;

const AGENT_CALLERS: ReadonlySet<string> = new Set([
  "tool",
  "mcp",
  "a2a",
  "webmcp",
]);

export function isAgentContextCaller(caller: string | undefined): boolean {
  return caller !== undefined && AGENT_CALLERS.has(caller);
}

function panelBindings(
  panelConfig: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const bindings: Record<string, unknown> = {};
  for (const key of BINDING_KEYS) {
    if (panelConfig[key] !== undefined) bindings[key] = panelConfig[key];
  }
  if (Array.isArray(panelConfig.columns)) {
    const columns = panelConfig.columns.flatMap((column) =>
      column && typeof column.key === "string" ? [column.key] : [],
    );
    if (columns.length > 0) bindings.columns = columns;
  }
  return Object.keys(bindings).length > 0 ? bindings : undefined;
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
    const sql = typeof panel.sql === "string" ? panel.sql : undefined;
    const configKeys = Object.keys(panelConfig);
    return {
      index,
      id: typeof panel.id === "string" ? panel.id : "",
      title: typeof panel.title === "string" ? panel.title : "",
      chartType: typeof panel.chartType === "string" ? panel.chartType : "",
      source: typeof panel.source === "string" ? panel.source : undefined,
      width: typeof panel.width === "number" ? panel.width : undefined,
      columns: typeof panel.columns === "number" ? panel.columns : undefined,
      tab: typeof panel.tab === "string" ? panel.tab : undefined,
      timeScope:
        typeof panelConfig.timeScope === "string"
          ? panelConfig.timeScope
          : undefined,
      description:
        typeof panelConfig.description === "string"
          ? panelConfig.description
          : undefined,
      extensionId:
        typeof panelConfig.extensionId === "string"
          ? panelConfig.extensionId
          : undefined,
      extensionSlotId:
        typeof panelConfig.extensionSlotId === "string"
          ? panelConfig.extensionSlotId
          : undefined,
      bindings: panelBindings(panelConfig),
      sqlChars: sql?.length,
      sqlHash: sql
        ? createHash("sha256").update(sql).digest("hex").slice(0, 12)
        : undefined,
      configKeys: configKeys.length > 0 ? configKeys : undefined,
    };
  });
}

export interface DashboardAgentContextOptions {
  /** Merge the saved config, including every panel's SQL. */
  includeConfig?: boolean;
  /** Full SQL and config for just these panels, under `panelDetails`. */
  panelIds?: readonly string[];
  /** The agent's projection: no owner, org, or audit fields, and an
   *  `includeConfig` result over the size cap becomes summaries plus
   *  `truncated: true`. The UI reads the same action and gets everything. */
  forAgent?: boolean;
}

function mergeSavedConfig(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base, ...config };
  // The saved config is author-controlled; what the server says about the
  // record must win.
  for (const key of ["createdBy", "certification", "certified"]) {
    if (key in base) merged[key] = base[key];
    else delete merged[key];
  }
  return merged;
}

function withRequestedDetail(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
  options: DashboardAgentContextOptions,
): Record<string, unknown> {
  const panels = Array.isArray(config.panels)
    ? (config.panels as Array<Record<string, unknown>>)
    : [];
  const compact: Record<string, unknown> = { ...base };
  if (options.panelIds && options.panelIds.length > 0) {
    const wanted = new Set(options.panelIds);
    const found = panels.filter(
      (panel) => typeof panel.id === "string" && wanted.has(panel.id),
    );
    compact.panelDetails = found;
    const foundIds = new Set(found.map((panel) => panel.id));
    const missing = options.panelIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) compact.missingPanelIds = missing;
  }
  if (options.includeConfig !== true) return compact;

  const full = mergeSavedConfig(compact, config);
  if (
    !options.forAgent ||
    JSON.stringify(full).length <= AGENT_FULL_CONFIG_MAX_CHARS
  ) {
    return full;
  }
  return {
    ...compact,
    truncated: true,
    omittedPanelIds: panels.flatMap((panel) =>
      typeof panel.id === "string" ? [panel.id] : [],
    ),
    hint: `The full config is over ${AGENT_FULL_CONFIG_MAX_CHARS.toLocaleString()} characters, so only summaries are returned. Call get-sql-dashboard again with panelIds for the panels whose SQL and config you need.`,
  };
}

export function buildDashboardAgentContext(
  dashboard: DashboardRecord,
  options: DashboardAgentContextOptions = {},
): Record<string, unknown> {
  const config = dashboard.config as Record<string, unknown>;
  const audit = options.forAgent
    ? {}
    : {
        ownerEmail: dashboard.ownerEmail,
        orgId: dashboard.orgId,
        hiddenAt: dashboard.hiddenAt,
        hiddenBy: dashboard.hiddenBy,
        createdAt: dashboard.createdAt,
        createdBy: dashboard.createdBy,
        updatedBy: dashboard.updatedBy,
      };
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
    ...audit,
    visibility: dashboard.visibility,
    role: dashboard.role,
    canEdit: dashboard.canEdit,
    canManage: dashboard.canManage,
    archivedAt: dashboard.archivedAt,
    updatedAt: dashboard.updatedAt,
    revision: dashboard.updatedAt,
    certification: dashboard.certification ?? null,
    certified: isDashboardCertified(
      dashboard.certification,
      dashboard.updatedAt,
    ),
    url: `/dashboards/${dashboard.id}`,
  };
  return withRequestedDetail(base, config, options);
}

export function buildDashboardSeedAgentContext(
  id: string,
  seed: Record<string, unknown>,
  options: DashboardAgentContextOptions = {},
): Record<string, unknown> {
  const audit = options.forAgent
    ? {}
    : {
        ownerEmail: null,
        orgId: null,
        hiddenAt: null,
        hiddenBy: null,
        createdBy: null,
      };
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
    ...audit,
    visibility: "org",
    archivedAt: null,
    certification: null,
    certified: false,
    url: `/dashboards/${id}`,
  };
  return withRequestedDetail(base, seed, options);
}

/**
 * The auto-injected `<current-screen>` block is cut at a fixed size, mid-JSON.
 * A dashboard too big for `maxChars` sheds detail in labelled steps instead, so
 * the model always reads valid JSON and knows what was left out.
 */
export function fitDashboardScreenContext(
  context: Record<string, unknown>,
  maxChars: number,
): Record<string, unknown> {
  const length = (value: unknown) => JSON.stringify(value, null, 2).length;
  if (length(context) <= maxChars) return context;

  const layout = context.layout as {
    panelCount?: unknown;
    firstPanelIds?: unknown;
  };
  const panels = (context.panels as Array<Record<string, unknown>>).map(
    ({ id, title, chartType }) => ({ id, title, chartType }),
  );
  const slim: Record<string, unknown> = {
    ...context,
    layout: {
      panelCount: layout.panelCount,
      firstPanelIds: layout.firstPanelIds,
    },
    panels,
    trimmed: true,
    hint: "Panel bindings and layout rows are omitted to fit. Call get-sql-dashboard for them, with panelIds for a panel's SQL and config.",
  };
  let kept = panels.length;
  while (kept > 0 && length(slim) > maxChars) {
    kept -= 1;
    slim.panels = panels.slice(0, kept);
    slim.omittedPanelCount = panels.length - kept;
  }
  return slim;
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
