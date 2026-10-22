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

export type DataWidgetActionIcon = "explore" | "camera" | "notebook";

export interface DataWidgetAction {
  label: string;
  href: string;
  icon?: DataWidgetActionIcon;
}

export interface DataWidgetChartAction extends DataWidgetAction {
  presentation?: "icon";
}

export interface DataChartWidget {
  type: "bar" | "line" | "area";
  title?: string;
  layout?: "horizontal" | "vertical";
  xAxisTitle?: string;
  yAxisTitle?: string;
  showValueLabels?: boolean;
  /** Total chart-body height in pixels, including content padding. */
  contentHeight?: number;
  /** Inner chart-body padding in pixels. */
  contentPadding?: number;
  /** Font family token used by chart labels. Defaults to the app's sans font. */
  labelFontFamily?: "sans" | "serif" | "mono";
  /** Chart-label size in pixels. Defaults to 11. */
  labelFontSize?: number;
  axisTitleFontSize?: number;
  axisTitleFontWeight?: 400 | 500;
  valueLabelFontSize?: number;
  valueLabelFontWeight?: 400 | 500;
  valueAxisTickInterval?: number;
  /** Fraction of each horizontal-bar category slot left empty; defaults to the existing spacing. */
  horizontalCategoryGapRatio?: number;
  xKey: string;
  series: DataChartSeriesDefinition[];
  data: Array<Record<string, unknown>>;
  sampled?: boolean;
  actions?: DataWidgetChartAction[];
}

export interface DataWidgetDisplay {
  title?: string;
  description?: string;
  primaryAction?: DataWidgetAction;
  sources?: DataWidgetDataSource[];
  actions?: DataWidgetDisplayAction[];
}

export interface DataWidgetDataSource {
  id?: string;
  label: string;
  href?: string;
}

export type DataWidgetDisplayAction =
  | {
      id?: string;
      type: "link";
      label: string;
      href: string;
      icon?: DataWidgetActionIcon;
      presentation?: "icon";
    }
  | {
      id?: string;
      type: "copy";
      label: string;
      text: string;
    };

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

const MAX_DATA_CHART_AXIS_TICKS = 100;

function numericWidgetValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasBoundedValueAxisTicks(chart: Record<string, unknown>): boolean {
  const interval = chart.valueAxisTickInterval;
  if (interval === undefined) return true;
  if (
    typeof interval !== "number" ||
    !Number.isFinite(interval) ||
    interval < 1e-12
  ) {
    return false;
  }

  const series = Array.isArray(chart.series) ? chart.series : [];
  const rows = Array.isArray(chart.data) ? chart.data : [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    if (!isRecord(row)) continue;
    for (const item of series) {
      if (!isRecord(item) || !isString(item.key)) continue;
      const value = numericWidgetValue(row[item.key]);
      if (value === null) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  } else {
    if (chart.type === "bar" || chart.type === "area") {
      min = Math.min(0, min);
      max = Math.max(0, max);
    }
    if (min === max) {
      const padding = Math.abs(max || 1) * 0.2;
      min -= padding;
      max += padding;
    }
  }

  if (!Number.isFinite(max - min)) return false;

  const firstTick = Math.ceil(min / interval - 1e-9);
  const lastTick = Math.floor(max / interval + 1e-9);
  const tickCount = lastTick - firstTick + 1;
  return (
    Number.isSafeInteger(firstTick) &&
    Number.isSafeInteger(lastTick) &&
    Number.isSafeInteger(tickCount) &&
    tickCount > 0 &&
    tickCount <= MAX_DATA_CHART_AXIS_TICKS
  );
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
    (value.layout === undefined ||
      value.layout === "horizontal" ||
      value.layout === "vertical") &&
    (value.xAxisTitle === undefined || typeof value.xAxisTitle === "string") &&
    (value.yAxisTitle === undefined || typeof value.yAxisTitle === "string") &&
    (value.showValueLabels === undefined ||
      typeof value.showValueLabels === "boolean") &&
    (value.contentHeight === undefined ||
      (typeof value.contentHeight === "number" &&
        Number.isFinite(value.contentHeight) &&
        value.contentHeight > 0 &&
        value.contentHeight <= 1200)) &&
    (value.contentPadding === undefined ||
      (typeof value.contentPadding === "number" &&
        Number.isFinite(value.contentPadding) &&
        value.contentPadding >= 0 &&
        value.contentPadding <= 64)) &&
    (value.labelFontFamily === undefined ||
      value.labelFontFamily === "sans" ||
      value.labelFontFamily === "serif" ||
      value.labelFontFamily === "mono") &&
    (value.labelFontSize === undefined ||
      (typeof value.labelFontSize === "number" &&
        Number.isInteger(value.labelFontSize) &&
        value.labelFontSize >= 8 &&
        value.labelFontSize <= 24)) &&
    (value.axisTitleFontSize === undefined ||
      (typeof value.axisTitleFontSize === "number" &&
        Number.isInteger(value.axisTitleFontSize) &&
        value.axisTitleFontSize >= 8 &&
        value.axisTitleFontSize <= 24)) &&
    (value.axisTitleFontWeight === undefined ||
      value.axisTitleFontWeight === 400 ||
      value.axisTitleFontWeight === 500) &&
    (value.valueLabelFontSize === undefined ||
      (typeof value.valueLabelFontSize === "number" &&
        Number.isInteger(value.valueLabelFontSize) &&
        value.valueLabelFontSize >= 8 &&
        value.valueLabelFontSize <= 24)) &&
    (value.valueLabelFontWeight === undefined ||
      value.valueLabelFontWeight === 400 ||
      value.valueLabelFontWeight === 500) &&
    (value.horizontalCategoryGapRatio === undefined ||
      (typeof value.horizontalCategoryGapRatio === "number" &&
        Number.isFinite(value.horizontalCategoryGapRatio) &&
        value.horizontalCategoryGapRatio >= 0 &&
        value.horizontalCategoryGapRatio <= 0.9)) &&
    hasBoundedValueAxisTicks(value) &&
    isString(value.xKey) &&
    Array.isArray(value.series) &&
    value.series.every(
      (series) =>
        isRecord(series) &&
        isString(series.key) &&
        isString(series.label) &&
        (series.color === undefined || typeof series.color === "string"),
    ) &&
    (value.actions === undefined ||
      (Array.isArray(value.actions) &&
        value.actions.every(isDataWidgetChartAction))) &&
    Array.isArray(value.data) &&
    value.data.every(isRecord)
  );
}

function isDataWidgetActionIcon(value: unknown): value is DataWidgetActionIcon {
  return value === "explore" || value === "camera" || value === "notebook";
}

function isDataWidgetAction(value: unknown): value is DataWidgetAction {
  return (
    isRecord(value) &&
    isString(value.label) &&
    isString(value.href) &&
    (value.icon === undefined || isDataWidgetActionIcon(value.icon))
  );
}

function isDataWidgetChartAction(
  value: unknown,
): value is DataWidgetChartAction {
  const presentation = isRecord(value) ? value.presentation : undefined;
  return (
    isDataWidgetAction(value) &&
    (presentation === undefined || presentation === "icon")
  );
}

function normalizePrimaryAction(value: unknown): DataWidgetAction | undefined {
  if (!isRecord(value) || !isString(value.label) || !isString(value.href)) {
    return undefined;
  }
  return {
    label: value.label,
    href: value.href,
    ...(isDataWidgetActionIcon(value.icon) ? { icon: value.icon } : {}),
  };
}

function isDataWidgetDataSource(value: unknown): value is DataWidgetDataSource {
  return (
    isRecord(value) &&
    isString(value.label) &&
    (value.id === undefined || typeof value.id === "string") &&
    (value.href === undefined || isString(value.href))
  );
}

function isDataWidgetDisplayAction(
  value: unknown,
): value is DataWidgetDisplayAction {
  if (
    !isRecord(value) ||
    !isString(value.label) ||
    (value.id !== undefined && typeof value.id !== "string")
  ) {
    return false;
  }
  if (value.type === "link") {
    return (
      isString(value.href) &&
      (value.icon === undefined || isDataWidgetActionIcon(value.icon)) &&
      (value.presentation === undefined || value.presentation === "icon")
    );
  }
  if (value.type === "copy") return isString(value.text);
  return false;
}

function normalizeDisplay(
  value: unknown,
): DataWidgetDisplay | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (
    (value.sources !== undefined &&
      (!Array.isArray(value.sources) ||
        !value.sources.every(isDataWidgetDataSource))) ||
    (value.actions !== undefined &&
      (!Array.isArray(value.actions) ||
        !value.actions.every(isDataWidgetDisplayAction)))
  ) {
    return null;
  }
  return {
    title: typeof value.title === "string" ? value.title : undefined,
    description:
      typeof value.description === "string" ? value.description : undefined,
    primaryAction: normalizePrimaryAction(value.primaryAction),
    sources: value.sources as DataWidgetDataSource[] | undefined,
    actions: value.actions as DataWidgetDisplayAction[] | undefined,
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
  const display = normalizeDisplay(value.display);
  if (display === null) return null;

  const table = isDataTableWidget(value.table) ? value.table : undefined;
  const chartSeries = isDataChartWidget(value.chartSeries)
    ? value.chartSeries
    : undefined;
  const base = {
    widgetId: typeof value.widgetId === "string" ? value.widgetId : undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    summary: isRecord(value.summary) ? value.summary : undefined,
    display,
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

export const DATA_WIDGET_MAX_ROWS = 50;
export const DATA_WIDGET_MAX_CHART_POINTS = 200;

export function clampDataWidgetRows(
  result: DataWidgetResult,
): DataWidgetResult {
  const source = result as Partial<DataInsightsWidgetResult>;
  const table = source.table;
  const chartSeries = source.chartSeries;

  const clampedTable =
    table && table.rows.length > DATA_WIDGET_MAX_ROWS
      ? {
          ...table,
          rows: table.rows.slice(0, DATA_WIDGET_MAX_ROWS),
          totalRows: table.totalRows ?? table.rows.length,
          sampledRows: DATA_WIDGET_MAX_ROWS,
          truncated: true,
        }
      : table;

  const clampedChart =
    chartSeries && chartSeries.data.length > DATA_WIDGET_MAX_CHART_POINTS
      ? {
          ...chartSeries,
          data: chartSeries.data.slice(0, DATA_WIDGET_MAX_CHART_POINTS),
          sampled: true,
        }
      : chartSeries;

  if (clampedTable === table && clampedChart === chartSeries) return result;
  return {
    ...result,
    ...(clampedTable ? { table: clampedTable } : {}),
    ...(clampedChart ? { chartSeries: clampedChart } : {}),
  } as DataWidgetResult;
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

const dataWidgetActionSchema = z
  .object({
    label: z.string().min(1),
    href: z.string().min(1),
    icon: z.enum(["explore", "camera", "notebook"]).optional(),
    presentation: z.literal("icon").optional(),
  })
  .passthrough();

export const dataChartWidgetSchema = z
  .object({
    type: z.enum(["bar", "line", "area"]),
    title: z.string().optional(),
    layout: z.enum(["horizontal", "vertical"]).optional(),
    xAxisTitle: z.string().optional(),
    yAxisTitle: z.string().optional(),
    showValueLabels: z.boolean().optional(),
    contentHeight: z.number().positive().max(1200).optional(),
    contentPadding: z.number().min(0).max(64).optional(),
    labelFontFamily: z.enum(["sans", "serif", "mono"]).optional(),
    labelFontSize: z.number().int().min(8).max(24).optional(),
    axisTitleFontSize: z.number().int().min(8).max(24).optional(),
    axisTitleFontWeight: z.union([z.literal(400), z.literal(500)]).optional(),
    valueLabelFontSize: z.number().int().min(8).max(24).optional(),
    valueLabelFontWeight: z.union([z.literal(400), z.literal(500)]).optional(),
    valueAxisTickInterval: z.number().finite().min(1e-12).optional(),
    horizontalCategoryGapRatio: z.number().finite().min(0).max(0.9).optional(),
    xKey: z.string().min(1),
    series: z.array(dataChartSeriesDefinitionSchema).min(1),
    data: z.array(z.record(z.string(), z.unknown())),
    sampled: z.boolean().optional(),
    actions: z.array(dataWidgetActionSchema).optional(),
  })
  .passthrough()
  .refine(hasBoundedValueAxisTicks, {
    path: ["valueAxisTickInterval"],
    message: `valueAxisTickInterval must produce between 1 and ${MAX_DATA_CHART_AXIS_TICKS} ticks.`,
  });

const primaryActionSchema = z
  .object({
    label: z.string().min(1),
    href: z.string().min(1),
    icon: z.enum(["explore", "camera", "notebook"]).optional(),
  })
  .passthrough();

const dataWidgetDataSourceSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().min(1),
    href: z.string().min(1).optional(),
  })
  .passthrough();

const dataWidgetDisplayActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.string().optional(),
      type: z.literal("link"),
      label: z.string().min(1),
      href: z.string().min(1),
      icon: z.enum(["explore", "camera", "notebook"]).optional(),
      presentation: z.literal("icon").optional(),
    })
    .passthrough(),
  z
    .object({
      id: z.string().optional(),
      type: z.literal("copy"),
      label: z.string().min(1),
      text: z.string().min(1),
    })
    .passthrough(),
]);

const dataWidgetDisplaySchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    primaryAction: primaryActionSchema.optional(),
    sources: z.array(dataWidgetDataSourceSchema).optional(),
    actions: z.array(dataWidgetDisplayActionSchema).optional(),
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
