import { z } from "zod";

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

export interface DataWidgetDisplay {
  title?: string;
  description?: string;
  primaryAction?: {
    label: string;
    href: string;
  };
}

export interface DataWidgetResultMetadata {
  widgetId?: string;
  title?: string;
  summary?: Record<string, unknown>;
  display?: DataWidgetDisplay;
}

export interface DataTableWidgetResultInput extends DataWidgetResultMetadata {
  table: DataTableWidget;
}

export interface DataChartWidgetResultInput extends DataWidgetResultMetadata {
  chartSeries: DataChartWidget;
}

export type DataInsightsWidgetResultInput = DataWidgetResultMetadata &
  (
    | {
        table: DataTableWidget;
        chartSeries?: DataChartWidget;
      }
    | {
        table?: DataTableWidget;
        chartSeries: DataChartWidget;
      }
  );

export type DataTableWidgetResult<
  Input extends DataTableWidgetResultInput = DataTableWidgetResultInput,
> = Omit<Input, "widget" | "chartSeries"> & {
  widget: typeof DATA_TABLE_WIDGET;
  table: Input["table"];
  chartSeries?: never;
};

export type DataChartWidgetResult<
  Input extends DataChartWidgetResultInput = DataChartWidgetResultInput,
> = Omit<Input, "widget" | "table"> & {
  widget: typeof DATA_CHART_WIDGET;
  table?: never;
  chartSeries: Input["chartSeries"];
};

export type DataInsightsWidgetResult<
  Input extends DataInsightsWidgetResultInput = DataInsightsWidgetResultInput,
> = Omit<Input, "widget"> & {
  widget: typeof DATA_INSIGHTS_WIDGET;
};

export type DataWidgetResult =
  | DataTableWidgetResult
  | DataChartWidgetResult
  | DataInsightsWidgetResult;

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
): value is NonNullable<DataWidgetDisplay["primaryAction"]> {
  return isRecord(value) && isString(value.label) && isString(value.href);
}

function normalizeDisplay(value: unknown): DataWidgetDisplay | undefined {
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

function assertDataTableWidget(
  table: unknown,
): asserts table is DataTableWidget {
  if (!isDataTableWidget(table)) {
    throw new Error("Invalid data-table widget payload");
  }
}

function assertDataChartWidget(
  chart: unknown,
): asserts chart is DataChartWidget {
  if (!isDataChartWidget(chart)) {
    throw new Error("Invalid data-chart widget payload");
  }
}

export function createDataTableWidgetResult<
  const Input extends DataTableWidgetResultInput,
>(
  input: Input & { widget?: never; chartSeries?: never },
): DataTableWidgetResult<Input> {
  assertDataTableWidget(input.table);
  return {
    ...input,
    widget: DATA_TABLE_WIDGET,
    table: input.table,
  } as DataTableWidgetResult<Input>;
}

export function createDataChartWidgetResult<
  const Input extends DataChartWidgetResultInput,
>(
  input: Input & { widget?: never; table?: never },
): DataChartWidgetResult<Input> {
  assertDataChartWidget(input.chartSeries);
  return {
    ...input,
    widget: DATA_CHART_WIDGET,
    chartSeries: input.chartSeries,
  } as DataChartWidgetResult<Input>;
}

export function createDataInsightsWidgetResult<
  const Input extends DataInsightsWidgetResultInput,
>(input: Input & { widget?: never }): DataInsightsWidgetResult<Input> {
  if (input.table !== undefined) assertDataTableWidget(input.table);
  if (input.chartSeries !== undefined) assertDataChartWidget(input.chartSeries);
  if (input.table === undefined && input.chartSeries === undefined) {
    throw new Error("data-insights widgets require table or chartSeries");
  }
  return {
    ...input,
    widget: DATA_INSIGHTS_WIDGET,
  } as DataInsightsWidgetResult<Input>;
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
  const base = {
    widgetId: typeof value.widgetId === "string" ? value.widgetId : undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    summary: isRecord(value.summary) ? value.summary : undefined,
    display: normalizeDisplay(value.display),
  };

  if (widget === DATA_TABLE_WIDGET) {
    if (!table) return null;
    return {
      ...base,
      widget: DATA_TABLE_WIDGET,
      table,
    };
  }

  if (widget === DATA_CHART_WIDGET) {
    if (!chartSeries) return null;
    return {
      ...base,
      widget: DATA_CHART_WIDGET,
      chartSeries,
    };
  }

  if (!table && !chartSeries) return null;
  return {
    ...base,
    widget: DATA_INSIGHTS_WIDGET,
    ...(table ? { table } : {}),
    ...(chartSeries ? { chartSeries } : {}),
  };
}

export function isDataWidgetResult(value: unknown): value is DataWidgetResult {
  return normalizeDataWidgetResult(value) !== null;
}

const dataTableColumnSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    align: z.enum(["left", "right"]).optional(),
  })
  .passthrough();

export const dataTableWidgetSchema = z
  .object({
    title: z.string().optional(),
    columns: z.array(dataTableColumnSchema).min(1),
    rows: z.array(z.record(z.string(), z.unknown())),
    totalRows: z.number().optional(),
    sampledRows: z.number().optional(),
    truncated: z.boolean().optional(),
  })
  .passthrough();

const dataChartSeriesDefinitionSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    color: z.string().optional(),
  })
  .passthrough();

export const dataChartWidgetSchema = z
  .object({
    type: z.enum(["bar", "line", "area"]),
    title: z.string().optional(),
    xKey: z.string().min(1),
    series: z.array(dataChartSeriesDefinitionSchema).min(1),
    data: z.array(z.record(z.string(), z.unknown())),
    sampled: z.boolean().optional(),
  })
  .passthrough();

const primaryActionSchema = z
  .object({
    label: z.string().min(1),
    href: z.string().min(1),
  })
  .passthrough();

const dataWidgetDisplaySchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    primaryAction: primaryActionSchema.optional(),
  })
  .passthrough();

const dataWidgetBaseSchema = z
  .object({
    widgetId: z.string().optional(),
    title: z.string().optional(),
    summary: z.record(z.string(), z.unknown()).optional(),
    display: dataWidgetDisplaySchema.optional(),
  })
  .passthrough();

export const dataTableWidgetResultSchema = dataWidgetBaseSchema
  .extend({
    widget: z.literal(DATA_TABLE_WIDGET),
    table: dataTableWidgetSchema,
  })
  .passthrough();

export const dataChartWidgetResultSchema = dataWidgetBaseSchema
  .extend({
    widget: z.literal(DATA_CHART_WIDGET),
    chartSeries: dataChartWidgetSchema,
  })
  .passthrough();

export const dataInsightsWidgetResultSchema = dataWidgetBaseSchema
  .extend({
    widget: z.literal(DATA_INSIGHTS_WIDGET),
    table: dataTableWidgetSchema.optional(),
    chartSeries: dataChartWidgetSchema.optional(),
  })
  .passthrough()
  .refine((value) => value.table || value.chartSeries, {
    message: "data-insights widgets require table or chartSeries",
  });

export const dataWidgetResultSchema = z.union([
  dataTableWidgetResultSchema,
  dataChartWidgetResultSchema,
  dataInsightsWidgetResultSchema,
]);
