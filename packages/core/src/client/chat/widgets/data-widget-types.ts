export const DATA_TABLE_WIDGET = "data-table";
export const DATA_CHART_WIDGET = "data-chart";
export const DATA_INSIGHTS_WIDGET = "data-insights";

export type DataWidgetKind =
  | typeof DATA_TABLE_WIDGET
  | typeof DATA_CHART_WIDGET
  | typeof DATA_INSIGHTS_WIDGET;

export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface DataTableWidget {
  title?: string;
  columns: DataTableColumn[];
  rows: Array<Record<string, unknown>>;
  totalRows?: number;
  sampledRows?: number;
  truncated?: boolean;
}

export interface DataChartSeriesDefinition {
  key: string;
  label: string;
  color?: string;
}

export interface DataChartWidget {
  type: "bar" | "line" | "area";
  title?: string;
  xKey: string;
  series: DataChartSeriesDefinition[];
  data: Array<Record<string, unknown>>;
  sampled?: boolean;
}

export interface DataWidgetResult {
  widget: DataWidgetKind;
  widgetId?: string;
  title?: string;
  summary?: Record<string, unknown>;
  table?: DataTableWidget;
  chartSeries?: DataChartWidget;
  display?: {
    title?: string;
    description?: string;
    primaryAction?: {
      label: string;
      href: string;
    };
  };
}

const LEGACY_DATA_WIDGET_KINDS: Record<string, DataWidgetKind> = {
  "data-table.v1": DATA_TABLE_WIDGET,
  "data-chart.v1": DATA_CHART_WIDGET,
  "data-insights.v1": DATA_INSIGHTS_WIDGET,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function normalizeDataWidgetKind(value: unknown): DataWidgetKind | null {
  if (value === DATA_TABLE_WIDGET) return DATA_TABLE_WIDGET;
  if (value === DATA_CHART_WIDGET) return DATA_CHART_WIDGET;
  if (value === DATA_INSIGHTS_WIDGET) return DATA_INSIGHTS_WIDGET;
  return isString(value) ? (LEGACY_DATA_WIDGET_KINDS[value] ?? null) : null;
}

export function isDataTableWidget(value: unknown): value is DataTableWidget {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.columns) &&
    value.columns.every(
      (column) =>
        isRecord(column) &&
        isString(column.key) &&
        isString(column.label) &&
        (column.align === undefined ||
          column.align === "left" ||
          column.align === "right"),
    ) &&
    Array.isArray(value.rows) &&
    value.rows.every(isRecord)
  );
}

export function isDataChartWidget(value: unknown): value is DataChartWidget {
  if (!isRecord(value)) return false;
  return (
    (value.type === "bar" || value.type === "line" || value.type === "area") &&
    isString(value.xKey) &&
    Array.isArray(value.series) &&
    value.series.every(
      (series) =>
        isRecord(series) &&
        isString(series.key) &&
        isString(series.label) &&
        (series.color === undefined || typeof series.color === "string"),
    ) &&
    Array.isArray(value.data) &&
    value.data.every(isRecord)
  );
}

function isPrimaryAction(
  value: unknown,
): value is NonNullable<DataWidgetResult["display"]>["primaryAction"] {
  return isRecord(value) && isString(value.label) && isString(value.href);
}

function normalizeDisplay(
  value: unknown,
): DataWidgetResult["display"] | undefined {
  if (!isRecord(value)) return undefined;
  return {
    title: typeof value.title === "string" ? value.title : undefined,
    description:
      typeof value.description === "string" ? value.description : undefined,
    primaryAction: isPrimaryAction(value.primaryAction)
      ? value.primaryAction
      : undefined,
  };
}

export function normalizeDataWidgetResult(
  value: unknown,
): DataWidgetResult | null {
  if (!isRecord(value)) return null;
  const widget = normalizeDataWidgetKind(value.widget);
  if (!widget) return null;

  const table = isDataTableWidget(value.table) ? value.table : undefined;
  const chartSeries = isDataChartWidget(value.chartSeries)
    ? value.chartSeries
    : undefined;
  if (widget === DATA_TABLE_WIDGET && !table) return null;
  if (widget === DATA_CHART_WIDGET && !chartSeries) return null;
  if (widget === DATA_INSIGHTS_WIDGET && !table && !chartSeries) return null;

  return {
    widget,
    widgetId: typeof value.widgetId === "string" ? value.widgetId : undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    summary: isRecord(value.summary) ? value.summary : undefined,
    table,
    chartSeries,
    display: normalizeDisplay(value.display),
  };
}

export function isDataWidgetResult(value: unknown): value is DataWidgetResult {
  return normalizeDataWidgetResult(value) !== null;
}
