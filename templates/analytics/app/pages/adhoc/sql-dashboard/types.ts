export type DataSourceType =
  | "bigquery"
  | "ga4"
  | "amplitude"
  | "first-party"
  | "demo"
  | "prometheus"
  | "program";

export type ChartType =
  | "line"
  | "area"
  | "bar"
  | "metric"
  | "table"
  | "pie"
  | "section"
  | "funnel"
  | "heatmap"
  | "callout"
  | "extension";

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

export type DashboardTimeScope =
  | "dashboard"
  | "fixed-window"
  | "cohort-history"
  | "all-time";

export interface SqlPanelConfig {
  timeScope?: DashboardTimeScope;
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  color?: string;
  colors?: string[];
  yFormatter?: "number" | "currency" | "percent";
  rightYKeys?: string[];
  rightYFormatter?: "number" | "currency" | "percent";
  seriesLabels?: Record<string, string>;
  description?: string;
  pivot?: PivotConfig;
  stacked?: boolean;
  legend?: boolean;
  valueLabels?: Record<string, string>;
  sortable?: boolean;
  columns?: TableColumnConfig[];
  limit?: number;
  extensionId?: string;
  extensionSlotId?: string;
  customBlock?: {
    authoredBy: "agent" | "user";
    intent: "one-off";
    scope: "dashboard";
    nativeGapReason:
      | "custom-visualization"
      | "custom-interaction"
      | "custom-layout"
      | "other";
  };
}

export interface SqlPanel {
  id: string;
  title: string;
  sql: string;
  source: DataSourceType;
  chartType: ChartType;
  width: number;
  columns?: number;
  config?: SqlPanelConfig;
  tab?: string;
}

export interface DashboardCertification {
  status: "certified";
  certifiedAt: string;
  certifiedBy: string;
  certifiedForUpdatedAt: string;
}

export interface SqlDashboardConfig {
  name: string;
  description?: string;
  certification?: DashboardCertification;
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
  columns?: number;
  panels: SqlPanel[];
}

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
