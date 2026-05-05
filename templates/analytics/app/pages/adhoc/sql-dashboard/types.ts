export type DataSourceType = "bigquery" | "ga4" | "amplitude" | "first-party";

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
  width: 1 | 2;
  config?: SqlPanelConfig;
  /**
   * Optional tab assignment. When any panel in a dashboard declares a `tab`,
   * the dashboard renders a tab strip and shows only panels matching the
   * selected tab. Tabs are derived from the distinct `tab` values across
   * panels in declaration order. Section panels can also carry a tab to
   * group their header under the right tab.
   */
  tab?: string;
}

export interface SqlDashboardConfig {
  name: string;
  description?: string;
  filters?: DashboardFilter[];
  variables?: Record<string, string>;
  panels: SqlPanel[];
}
