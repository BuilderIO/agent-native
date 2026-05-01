export type DataSourceType = "bigquery" | "ga4" | "amplitude" | "first-party";

export type ChartType = "line" | "area" | "bar" | "metric" | "table" | "pie";

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
  | "text";

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
}

export interface SqlDashboardConfig {
  name: string;
  description?: string;
  filters?: DashboardFilter[];
  variables?: Record<string, string>;
  panels: SqlPanel[];
}
