export type DataSourceType =
  | "bigquery"
  | "ga4"
  | "amplitude"
  | "first-party"
  | "demo"
  | "prometheus";

export type ChartType =
  | "line"
  | "area"
  | "bar"
  | "metric"
  | "table"
  | "pie"
  | "section"
  | "heatmap"
  | "callout";

export type FilterType =
  | "date"
  | "date-range"
  | "select"
  | "toggle"
  | "text"
  | "toggle-date";

export interface FilterOption {
  value: string;
  label: string;
}

export interface DashboardFilter {
  id: string;
  label: string;
  type: FilterType;
  default?: string;
  options?: FilterOption[];
}

export type ColumnFormat =
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "link"
  | "text"
  | "delta";

export interface TableColumnConfig {
  key: string;
  label?: string;
  format?: ColumnFormat;
  linkKey?: string;
  hidden?: boolean;
}

export interface PivotConfig {
  xKey: string;
  seriesKey: string;
  valueKey: string;
}

export interface SqlPanelConfig {
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  color?: string;
  colors?: string[];
  yFormatter?: "number" | "currency" | "percent";
  description?: string;
  pivot?: PivotConfig;
  /** Stack bar/area series on top of each other instead of side-by-side / overlapping. */
  stacked?: boolean;
  /** Show the chart legend. Defaults to true for chart renderers. */
  legend?: boolean;
  /** Optional display labels for exact metric values, e.g. {"0":"normal"}. */
  valueLabels?: Record<string, string>;
  sortable?: boolean;
  columns?: TableColumnConfig[];
  limit?: number;
}

export interface SqlPanel {
  id: string;
  title: string;
  sql: string;
  source: DataSourceType;
  chartType: ChartType;
  /**
   * Legacy layout field retained for existing dashboards and action payloads.
   * The renderer now auto-fits rows from panel order: one card in a row spans
   * the row, two cards split it, and so on up to the section column count.
   */
  width: number;
  /**
   * Section panels only: number of columns the panels following this section
   * (until the next section) should be laid out in. Falls back to the
   * dashboard-level `columns`, then to 2.
   */
  columns?: number;
  config?: SqlPanelConfig;
  /**
   * Optional tab assignment. When any panel in a dashboard declares a `tab`,
   * the dashboard renders a tab strip and shows only panels matching the
   * selected tab. Tabs are derived from the distinct `tab` values across
   * panels in declaration order. Use "Group / Tab" to render grouped primary
   * and secondary tabs without changing the storage model. Section panels can
   * also carry a tab to group their header under the right tab.
   */
  tab?: string;
}

export interface SqlDashboardConfig {
  name: string;
  description?: string;
  /**
   * Optional id of another dashboard this one nests under. When set, the
   * sidebar renders this dashboard indented beneath its parent instead of at
   * the top level. Orphans (parent missing/inaccessible) fall back to the top
   * level. Self-references and cycles are ignored by the renderer.
   */
  parentId?: string;
  catalog?: {
    templateId?: string;
    templateVersion?: string;
    installedAt?: string;
  };
  demo?: {
    id: string;
    version?: string;
    installedAt?: string;
  };
  filters?: DashboardFilter[];
  variables?: Record<string, string>;
  /**
   * Default column count for panels that appear before any section. Sections
   * can override this via their own `columns`. Always 1 column when the
   * available content width is below the `md` threshold (the grid uses a
   * container query, so it stacks when the agent sidebar narrows the pane —
   * not only at narrow viewports). Defaults to 2.
   */
  columns?: number;
  panels: SqlPanel[];
}

/**
 * Lower / upper bounds for the per-section column count. Keep in sync with
 * the validators in `actions/update-dashboard.ts`.
 */
export const MIN_DASHBOARD_COLUMNS = 1;
export const MAX_DASHBOARD_COLUMNS = 6;
export const DEFAULT_DASHBOARD_COLUMNS = 2;

export function clampDashboardColumns(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DASHBOARD_COLUMNS;
  }
  const integer = Math.floor(value);
  if (integer < MIN_DASHBOARD_COLUMNS) return MIN_DASHBOARD_COLUMNS;
  if (integer > MAX_DASHBOARD_COLUMNS) return MAX_DASHBOARD_COLUMNS;
  return integer;
}

export function clampPanelWidth(value: unknown, gridColumns: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  const integer = Math.floor(value);
  if (integer < 1) return 1;
  if (integer > gridColumns) return gridColumns;
  return integer;
}
