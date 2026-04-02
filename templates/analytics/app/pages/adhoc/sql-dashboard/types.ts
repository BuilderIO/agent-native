export type DataSourceType = "bigquery" | "app-db";

export type ChartType = "line" | "area" | "bar" | "metric" | "table" | "pie";

export interface SqlPanelConfig {
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  color?: string;
  colors?: string[];
  yFormatter?: "number" | "currency" | "percent";
  description?: string;
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
  panels: SqlPanel[];
}
