import type { useT } from "@agent-native/core/client/i18n";
import { useMemo, useState } from "react";

import { getCachedDateTimeFormat } from "@/lib/intl-cache";
import type {
  Cell,
  CellOutput,
  ChartMark,
  ChartSpec,
} from "@/lib/model/contracts";

import { resolveSeriesColors } from "./chart-palette";
import type { NotebookOutputs } from "./types";
import { formatCellValue } from "./utils";

/** One column of the result a chart is drawn from. */
export type ChartColumn = { name: string; type: string; label?: string };

type ChartValue = string | number | boolean | null;
export type ChartTimeUnit = NonNullable<ChartSpec["xTimeUnit"]>;
type ChartAggregation = NonNullable<ChartSpec["yAggregation"]>;
const DAY_MS = 86_400_000;
const MIDNIGHT_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ]00:00:00(?:\.0+)?(?:Z|\+00:00)?$/;
const MAX_DAY_FILL = 800;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function chartBucketFormatter(
  unit: ChartTimeUnit,
  locale: string,
  t: ReturnType<typeof useT>,
) {
  const format: Intl.DateTimeFormatOptions = {
    timeZone: "UTC",
    year: "numeric",
  };
  if (unit !== "year" && unit !== "quarter") format.month = "short";
  if (unit !== "year" && unit !== "quarter" && unit !== "month")
    format.day = "numeric";
  if (unit === "hour" || unit === "minute" || unit === "second")
    format.hour = "numeric";
  if (unit === "minute" || unit === "second") format.minute = "2-digit";
  if (unit === "second") format.second = "2-digit";
  const dateFormatter = getCachedDateTimeFormat(locale, format);
  return (value: unknown) => {
    if (typeof value !== "number" && typeof value !== "string")
      return formatCellValue(value);
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) return formatCellValue(value);
    return unit === "quarter"
      ? t("chartAxis.quarter", {
          year: date.getUTCFullYear(),
          quarter: Math.floor(date.getUTCMonth() / 3) + 1,
        })
      : dateFormatter.format(date);
  };
}

/**
 * A dataframe a chart can be drawn from: the result variable a run cell wrote,
 * with the columns and rows the notebook already holds for it. The source
 * builds charts from dataframes too (chart/editor/ChartDataEditor.tsx takes the
 * selected layer's dataframe and its field groups), so a chart names its data
 * source and the columns it plots rather than a query of its own.
 */
export type ChartDataframe = {
  name: string;
  cellId: string;
  exportId?: string;
  resultId?: string;
  sourceOrder?: string;
  columns: readonly ChartColumn[];
  rows: ReadonlyArray<ReadonlyArray<ChartValue>>;
  truncated?: boolean;
};

export type ChartDataframeResolution =
  | { status: "ready"; dataframe: ChartDataframe }
  | { status: "empty" }
  | {
      status: "error";
      reason: "invalidJson" | "invalidRows" | "sourceUnavailable";
    };

export function projectChartDataframes(
  cells: readonly Cell[],
  outputs: NotebookOutputs,
): ChartDataframe[] {
  const dataframes: ChartDataframe[] = [];
  for (const cell of cells) {
    const contents = cell.contents;
    if (contents.kind !== "sql" && contents.kind !== "code") continue;
    const name = contents.resultVariable?.trim();
    const state = outputs[cell.id];
    const output = state?.output;
    if (!name || output?.type !== "table") continue;
    dataframes.push({
      name,
      cellId: cell.id,
      sourceOrder: contents.order,
      ...(state?.pageRequestId && state.resultFields
        ? { resultId: state.pageRequestId }
        : {}),
      columns: output.columns,
      rows: output.rows,
      truncated: output.truncated,
    });
  }
  return dataframes;
}

export function resolveChartDataframe(
  dataframe: string | null,
  dataframes: readonly ChartDataframe[],
  output?: Extract<CellOutput, { type: "chart" }> | null,
  sourceCellId?: string | null,
  sourceExportId?: string | null,
): ChartDataframeResolution {
  const matched = dataframes.find((candidate) =>
    sourceCellId == null
      ? candidate.name === dataframe
      : candidate.cellId === sourceCellId &&
        (sourceExportId == null || candidate.exportId === sourceExportId),
  );
  if (matched) return { status: "ready", dataframe: matched };
  if (sourceCellId != null)
    return { status: "error", reason: "sourceUnavailable" };
  if (dataframe?.trimStart().startsWith("[")) {
    return inlineChartDataframe(dataframe);
  }
  if (output) {
    return {
      status: "ready",
      dataframe: {
        name: "Saved result",
        cellId: "saved-result",
        // Saved chart outputs omit types, so infer numeric axes from their rows.
        columns: output.columns.map((name, index) => ({
          name,
          type: inferredColumnType(
            output.rows.map((row) => row[index] ?? null),
          ),
        })),
        rows: output.rows,
      },
    };
  }
  return { status: "empty" };
}

/** The cells a chart draws, after its own choices narrow the dataframe. */
export type ChartSeries = {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  xField: string | null;
  yField: string | null;
  seriesField?: string | null;
  encoding?: ChartEncoding;
  colors?: readonly string[];
};

export type ChartEncoding = {
  timeUnit?: ChartTimeUnit | null;
  aggregation?: ChartAggregation;
  colorField: string | null;
  measures: Array<{ field: string; colorValue: ChartValue }>;
  colorDomain?: ChartValue[];
  colorIndices?: number[];
  countRecords?: boolean;
};

function inferredColumnType(values: ChartValue[]): string {
  const present = values.filter((value) => value !== null);
  if (present.some((value) => typeof value === "number")) return "number";
  if (
    present.length &&
    present.every(
      (value) =>
        typeof value === "string" &&
        /^\d{4}-\d{2}(?:-\d{2})?(?:$|[T ])/.test(value) &&
        Number.isFinite(Date.parse(value)),
    )
  )
    return "date";
  return "string";
}

export function useChartSeries(
  spec: ChartSpec,
  dataframe: ChartDataframe | null,
) {
  const projected = useMemo(
    () => chartSeriesFrom(spec, dataframe),
    [spec, dataframe],
  );
  const [palette, setPalette] = useState<{
    scope: string;
    domain: ChartValue[];
  }>({ scope: "", domain: [] });
  const encoding = projected.encoding;
  if (!encoding?.colorField || !dataframe) return projected;
  const field = encoding.colorField.trim().toLowerCase();
  const usePivotColors = spec.colors?.length
    ? spec.version !== 2
    : field === "app" ||
      field === "template" ||
      (spec.version !== 2 && Boolean(spec.seriesOrder?.length));
  const scope = JSON.stringify([dataframe.cellId, encoding.colorField]);
  const previous = palette.scope === scope ? palette.domain : [];
  const known = new Set(previous);
  const additions = (encoding.colorDomain ?? []).filter(
    (value) => !known.has(value),
  );
  if (!usePivotColors)
    additions.sort(
      (left, right) =>
        String(left ?? "").localeCompare(String(right ?? ""), "en-US") ||
        JSON.stringify(left).localeCompare(JSON.stringify(right), "en-US"),
    );
  const domain = additions.length ? [...previous, ...additions] : previous;
  if (scope !== palette.scope || additions.length)
    setPalette({ scope, domain });
  if (usePivotColors) {
    if (!previous.length) return projected;
    return {
      ...projected,
      colors: pivotSeriesColors(
        spec,
        encoding.colorField,
        domain,
        encoding.measures,
      ),
    };
  }
  const { colors: _colors, ...series } = projected;
  const colorIndices = new Map(domain.map((value, index) => [value, index]));
  return {
    ...series,
    encoding: {
      ...encoding,
      colorIndices: encoding.measures.map(
        ({ colorValue }) => colorIndices.get(colorValue) ?? 0,
      ),
    },
  };
}

export type ChartTypeOption = {
  id: string;
  mark: ChartMark;
  label: string;
  patch: Partial<ChartSpec>;
  isActive: (spec: ChartSpec) => boolean;
};

export type ChartTypeGroup = {
  name: string;
  items: ReadonlyArray<ChartTypeOption>;
};

function barOrientation(spec: ChartSpec): "vertical" | "horizontal" {
  return spec.orientation ?? "vertical";
}

function barStackMode(spec: ChartSpec): "grouped" | "stacked" | "normalize" {
  return spec.stackMode ?? (spec.stacked === true ? "stacked" : "grouped");
}

export const chartTypeGroups: ReadonlyArray<ChartTypeGroup> = [
  {
    name: "Column",
    items: [
      {
        id: "grouped-column",
        mark: "bar",
        label: "Grouped column",
        patch: {
          mark: "bar",
          orientation: "vertical",
          stacked: false,
          stackMode: "grouped",
        },
        isActive: (spec) =>
          spec.mark === "bar" &&
          barOrientation(spec) === "vertical" &&
          barStackMode(spec) === "grouped",
      },
      {
        id: "stacked-column",
        mark: "bar",
        label: "Stacked column",
        patch: {
          mark: "bar",
          orientation: "vertical",
          stacked: true,
          stackMode: "stacked",
        },
        isActive: (spec) =>
          spec.mark === "bar" &&
          barOrientation(spec) === "vertical" &&
          barStackMode(spec) === "stacked",
      },
      {
        id: "percent-stacked-column",
        mark: "bar",
        label: "100% Stacked column",
        patch: {
          mark: "bar",
          orientation: "vertical",
          stacked: true,
          stackMode: "normalize",
        },
        isActive: (spec) =>
          spec.mark === "bar" &&
          barOrientation(spec) === "vertical" &&
          barStackMode(spec) === "normalize",
      },
    ],
  },
  {
    name: "Bar",
    items: [
      {
        id: "grouped-bar",
        mark: "bar",
        label: "Grouped bar",
        patch: {
          mark: "bar",
          orientation: "horizontal",
          stacked: false,
          stackMode: "grouped",
        },
        isActive: (spec) =>
          spec.mark === "bar" &&
          barOrientation(spec) === "horizontal" &&
          barStackMode(spec) === "grouped",
      },
      {
        id: "stacked-bar",
        mark: "bar",
        label: "Stacked bar",
        patch: {
          mark: "bar",
          orientation: "horizontal",
          stacked: true,
          stackMode: "stacked",
        },
        isActive: (spec) =>
          spec.mark === "bar" &&
          barOrientation(spec) === "horizontal" &&
          barStackMode(spec) === "stacked",
      },
      {
        id: "percent-stacked-bar",
        mark: "bar",
        label: "100% Stacked bar",
        patch: {
          mark: "bar",
          orientation: "horizontal",
          stacked: true,
          stackMode: "normalize",
        },
        isActive: (spec) =>
          spec.mark === "bar" &&
          barOrientation(spec) === "horizontal" &&
          barStackMode(spec) === "normalize",
      },
    ],
  },
  {
    name: "Line & Area",
    items: [
      {
        id: "line",
        mark: "line",
        label: "Line",
        patch: {
          mark: "line",
          orientation: undefined,
          stacked: false,
          stackMode: undefined,
        },
        isActive: (spec) => spec.mark === "line",
      },
      {
        id: "stacked-area",
        mark: "area",
        label: "Stacked area",
        patch: {
          mark: "area",
          orientation: undefined,
          stacked: true,
          stackMode: "stacked",
        },
        isActive: (spec) =>
          spec.mark === "area" && spec.stackMode !== "normalize",
      },
      {
        id: "percent-stacked-area",
        mark: "area",
        label: "100% Stacked area",
        patch: {
          mark: "area",
          orientation: undefined,
          stacked: true,
          stackMode: "normalize",
        },
        isActive: (spec) =>
          spec.mark === "area" && spec.stackMode === "normalize",
      },
    ],
  },
  {
    name: "Other",
    items: [
      {
        id: "histogram",
        mark: "histogram",
        label: "Histogram",
        patch: {
          mark: "histogram",
          orientation: undefined,
          stacked: false,
          stackMode: undefined,
        },
        isActive: (spec) => spec.mark === "histogram",
      },
      {
        id: "combo",
        mark: "combo",
        label: "Combo",
        patch: {
          mark: "combo",
          orientation: undefined,
          stacked: false,
          stackMode: undefined,
        },
        isActive: (spec) => spec.mark === "combo",
      },
      {
        id: "heatmap",
        mark: "heatmap",
        label: "Heat map",
        patch: {
          mark: "heatmap",
          orientation: undefined,
          stacked: false,
          stackMode: undefined,
        },
        isActive: (spec) => spec.mark === "heatmap",
      },
      {
        id: "gantt",
        mark: "gantt",
        label: "Gantt",
        patch: {
          mark: "gantt",
          orientation: undefined,
          stacked: false,
          stackMode: undefined,
        },
        isActive: (spec) => spec.mark === "gantt",
      },
      {
        id: "scatter",
        mark: "scatter",
        label: "Scatter",
        patch: {
          mark: "scatter",
          orientation: undefined,
          stacked: false,
          stackMode: undefined,
        },
        isActive: (spec) => spec.mark === "scatter",
      },
      {
        id: "pie",
        mark: "pie",
        label: "Pie",
        patch: {
          mark: "pie",
          orientation: undefined,
          stacked: false,
          stackMode: undefined,
        },
        isActive: (spec) => spec.mark === "pie",
      },
      {
        id: "sankey",
        mark: "sankey",
        label: "Sankey",
        patch: {
          mark: "sankey",
          orientation: undefined,
          stacked: false,
          stackMode: undefined,
        },
        isActive: (spec) => spec.mark === "sankey",
      },
      {
        id: "funnel",
        mark: "funnel",
        label: "Funnel",
        patch: {
          mark: "funnel",
          orientation: undefined,
          stacked: false,
          stackMode: undefined,
        },
        isActive: (spec) => spec.mark === "funnel",
      },
    ],
  },
];

export const chartMarkGroups = chartTypeGroups;

export function chartMarkLabel(mark: ChartMark): string {
  for (const group of chartTypeGroups) {
    for (const item of group.items) {
      if (item.mark === mark) return item.label;
    }
  }
  return mark;
}

/** The columns a chart can choose from, by the names its dataframe reports. */
export function chartColumnNames(columns: readonly ChartColumn[]): string[] {
  return columns.map((column) => column.name);
}

function resolveColumnName(
  field: string | null | undefined,
  names: readonly string[],
  fieldLabels?: Record<string, string>,
): string | null {
  if (field == null) return null;
  if (names.includes(field)) return field;
  const labeled = fieldLabels?.[field];
  return labeled != null && names.includes(labeled) ? labeled : null;
}

/** The column a chart plots along its category axis. */
export function chartXField(
  spec: ChartSpec,
  columns: readonly ChartColumn[],
): string | null {
  const names = chartColumnNames(columns);
  return resolveColumnName(spec.xField, names, spec.fieldLabels);
}

export function chartYField(
  spec: ChartSpec,
  columns: readonly ChartColumn[],
): string | null {
  const names = chartColumnNames(columns);
  const resolved = resolveColumnName(spec.yField, names, spec.fieldLabels);
  if (resolved != null) return resolved;
  if (spec.version === 2) return null;
  const x = chartXField(spec, columns);
  const numeric = columns.find(
    (column) => column.type === "number" && column.name !== x,
  );
  return numeric?.name ?? null;
}

export function chartTimeUnitFor(spec: ChartSpec, xType?: string) {
  return xType === "date" || xType === "datetime"
    ? (spec.xTimeUnit ?? "month")
    : null;
}

const NUMERIC_COLUMN_TYPES = ["number", "decimal", "integer"];
const NON_NUMERIC_AGGREGATIONS: readonly ChartAggregation[] = [
  "none",
  "count",
  "distinct_count",
  "min",
  "max",
];

export function isNumericChartColumnType(type: string | undefined): boolean {
  return type !== undefined && NUMERIC_COLUMN_TYPES.includes(type);
}

/** The aggregations that are meaningful for a measure of this column type. */
export function chartAggregationsForType(
  type: string | undefined,
  all: readonly ChartAggregation[],
): ChartAggregation[] {
  return type === undefined || isNumericChartColumnType(type)
    ? [...all]
    : all.filter((value) => NON_NUMERIC_AGGREGATIONS.includes(value));
}

export function chartAggregationFor(spec: ChartSpec, numeric: boolean) {
  return spec.yAggregation ?? (numeric ? "sum" : "none");
}

export function chartSeriesFrom(
  spec: ChartSpec,
  dataframe: ChartDataframe | null,
): ChartSeries {
  if (dataframe == null) {
    return { columns: [], rows: [], xField: null, yField: null };
  }
  const xField = chartXField(spec, dataframe.columns);
  const yField = chartYField(spec, dataframe.columns);
  const countRecords = spec.version === 2 && spec.countRecords === true;
  const names = chartColumnNames(dataframe.columns);
  if (spec.mark === "histogram") {
    if (spec.version === 2 && xField == null) {
      return { columns: [], rows: [], xField, yField: null };
    }
    const fallbackX =
      dataframe.columns.find((column) => column.type === "number")?.name ??
      names[0] ??
      "";
    const histXIndex = names.indexOf(xField ?? fallbackX);
    if (histXIndex < 0) {
      return { columns: [], rows: [], xField, yField: null };
    }
    const colType = dataframe.columns[histXIndex]?.type;
    return {
      columns: [names[histXIndex] ?? ""],
      rows: dataframe.rows.map((row) => [
        chartMeasure(row[histXIndex] ?? null, colType),
      ]),
      xField: names[histXIndex] ?? null,
      yField: null,
    };
  }
  if (spec.mark === "gantt") {
    const taskName = xField ?? (spec.version === 2 ? null : (names[0] ?? null));
    const taskIndex = taskName == null ? -1 : names.indexOf(taskName);
    const startName =
      yField ??
      (spec.version === 2
        ? null
        : (names.find((_, index) => index !== taskIndex) ?? null));
    const startIndex = startName == null ? -1 : names.indexOf(startName);
    const explicitEnd =
      spec.endField != null && names.includes(spec.endField)
        ? spec.endField
        : null;
    const endName =
      explicitEnd ??
      (spec.version === 2
        ? null
        : (names.find(
            (_, index) => index !== taskIndex && index !== startIndex,
          ) ?? null));
    const endIndex = endName == null ? -1 : names.indexOf(endName);
    if (taskIndex < 0 || startIndex < 0 || endIndex < 0) {
      return { columns: [], rows: [], xField: taskName, yField: startName };
    }
    const colorIndex =
      spec.seriesField == null ? -1 : names.indexOf(spec.seriesField);
    return {
      columns: [
        names[taskIndex] ?? "",
        names[startIndex] ?? "",
        names[endIndex] ?? "",
        ...(colorIndex >= 0 ? [names[colorIndex] ?? ""] : []),
      ],
      rows: dataframe.rows.map((row) => [
        row[taskIndex] ?? null,
        row[startIndex] ?? null,
        row[endIndex] ?? null,
        ...(colorIndex >= 0 ? [row[colorIndex] ?? null] : []),
      ]),
      xField: taskName,
      yField: startName,
      ...(colorIndex >= 0 ? { seriesField: names[colorIndex] ?? null } : {}),
    };
  }
  if (
    spec.version === 2 &&
    (xField == null || (yField == null && !countRecords))
  ) {
    return { columns: [], rows: [], xField, yField };
  }
  const xIndex = names.indexOf(xField ?? names[0] ?? "");
  const yIndex = yField == null ? -1 : names.indexOf(yField);
  if (spec.mark === "funnel" && spec.funnelOutcomes) {
    const funnelXIndex = spec.xField != null && xField == null ? -1 : xIndex;
    const resolvedY = resolveColumnName(spec.yField, names, spec.fieldLabels);
    const funnelYIndex =
      (spec.yField != null && resolvedY == null) || yIndex === funnelXIndex
        ? -1
        : yIndex;
    const indices = [
      funnelXIndex,
      funnelYIndex,
      ...names
        .map((_, index) => index)
        .filter((index) => index !== funnelXIndex && index !== funnelYIndex),
    ];
    return {
      columns: indices.map((index) => names[index] ?? ""),
      rows: dataframe.rows.map((row) =>
        indices.map((index) => row[index] ?? null),
      ),
      xField,
      yField,
    };
  }
  if (spec.mark === "sankey") {
    const targetIndex =
      spec.seriesField == null ? -1 : names.indexOf(spec.seriesField);
    if (
      xIndex < 0 ||
      targetIndex < 0 ||
      yIndex < 0 ||
      new Set([xIndex, targetIndex, yIndex]).size !== 3
    ) {
      return {
        columns: [],
        rows: [],
        xField,
        yField,
        seriesField: spec.seriesField,
      };
    }
    return {
      columns: [
        names[xIndex] ?? "",
        names[targetIndex] ?? "",
        names[yIndex] ?? "",
      ],
      rows: dataframe.rows.map((row) => [
        row[xIndex] ?? null,
        row[targetIndex] ?? null,
        chartMeasure(row[yIndex] ?? null, dataframe.columns[yIndex]?.type),
      ]),
      xField,
      yField,
      seriesField: spec.seriesField,
    };
  }
  if (xIndex < 0 || (yIndex < 0 && !countRecords)) {
    return { columns: [], rows: [], xField, yField };
  }
  const rawMeasures =
    spec.mark === "combo"
      ? [
          ...(yField ? [yField] : []),
          ...(spec.secondaryYField ? [spec.secondaryYField] : []),
          ...(spec.yFields ?? []),
        ]
      : spec.yFields?.length && spec.mark !== "pie"
        ? spec.yFields
        : [yField ?? ""];
  const indices = [...new Set(rawMeasures)]
    .map((field) => names.indexOf(field))
    .filter((index) => index >= 0 && index !== xIndex);
  const seriesIndex =
    spec.seriesField == null ? -1 : names.indexOf(spec.seriesField);
  const split =
    seriesIndex >= 0 &&
    seriesIndex !== xIndex &&
    !indices.includes(seriesIndex);
  if (
    spec.mark === "line" ||
    spec.mark === "heatmap" ||
    ((spec.version === 2 || split) &&
      (spec.mark === "bar" || spec.mark === "area" || spec.mark === "combo"))
  ) {
    return {
      xField,
      yField,
      ...(spec.version !== 2 && spec.mark !== "line"
        ? { seriesField: spec.seriesField }
        : {}),
      ...aggregateSeriesFrom(
        spec,
        dataframe,
        xIndex,
        countRecords ? [-1] : indices,
        split ? seriesIndex : -1,
        countRecords,
      ),
    };
  }
  return {
    columns: [
      names[xIndex] ?? "",
      ...indices.map((index) => names[index] ?? ""),
    ],
    rows: dataframe.rows.map((row) => [
      row[xIndex] ?? null,
      ...indices.map((index) =>
        chartMeasure(row[index] ?? null, dataframe.columns[index]?.type),
      ),
    ]),
    xField,
    yField,
  };
}

function aggregateSeriesFrom(
  spec: ChartSpec,
  dataframe: ChartDataframe,
  xIndex: number,
  measureIndices: number[],
  colorIndex: number,
  countRecords: boolean,
): Pick<ChartSeries, "columns" | "rows" | "encoding" | "colors"> {
  const { columns, rows } = dataframe;
  const legacyBarOrArea = spec.version !== 2 && spec.mark !== "line";
  const timeUnit = legacyBarOrArea
    ? null
    : chartTimeUnitFor(spec, columns[xIndex]?.type);
  const legacyPivot =
    colorIndex >= 0 && spec.version !== 2 && timeUnit === null;
  const aggregation = countRecords
    ? "count"
    : legacyBarOrArea
      ? "sum"
      : chartAggregationFor(
          spec,
          measureIndices.some((index) => columns[index]?.type === "number"),
        );
  const groups = new Set<ChartValue>();
  type Category = {
    x: ChartValue;
    colors: Map<ChartValue, Array<ReadonlyArray<ChartValue>>>;
  };
  let categories: Category[] = [];
  const byX = new Map<ChartValue, Category>();
  const fillsDays =
    colorIndex >= 0 && (spec.mark === "line" || spec.mark === "area");
  for (const row of rows) {
    const x =
      timeUnit === null
        ? fillsDays
          ? dayOfMidnightTimestamp(row[xIndex] ?? null)
          : (row[xIndex] ?? null)
        : bucketChartDate(row[xIndex], timeUnit);
    if (timeUnit !== null && x === null) continue;
    const color = row[colorIndex] ?? null;
    groups.add(color);
    let category = byX.get(x);
    if (!category || aggregation === "none") {
      category = { x, colors: new Map() };
      categories.push(category);
      if (aggregation !== "none") byX.set(x, category);
    }
    const existing = category.colors.get(color);
    if (existing) existing.push(row);
    else category.colors.set(color, [row]);
  }
  if (timeUnit !== null)
    categories.sort((left, right) => Number(left.x) - Number(right.x));
  const days =
    colorIndex >= 0 &&
    aggregation !== "none" &&
    (spec.mark === "line" || spec.mark === "area")
      ? calendarDays(
          categories.map(({ x }) => x),
          timeUnit,
        )
      : [];
  if (days.length) {
    const first = days.reduce((min, day) => Math.min(min, day));
    const last = days.reduce((max, day) => Math.max(max, day));
    const span = (last - first) / DAY_MS + 1;
    if (span <= MAX_DAY_FILL) {
      categories = Array.from({ length: span }, (_, index) => {
        const day = first + index * DAY_MS;
        const x =
          timeUnit === "day" ? day : new Date(day).toISOString().slice(0, 10);
        return byX.get(x) ?? { x, colors: new Map() };
      });
    }
  }

  const colorDomain = [...groups];
  const series = colorDomain.flatMap((colorValue) =>
    measureIndices.map((index, measureIndex) => {
      const field = columns[index]?.name ?? "";
      const label =
        colorIndex < 0
          ? field
          : measureIndices.length === 1
            ? String(colorValue ?? "")
            : `${colorValue ?? ""} — ${field}`;
      const values = categories.map(({ colors }) => {
        const matching = colors.get(colorValue);
        if (!matching) return legacyPivot || days.length ? 0 : null;
        if (countRecords) return matching.length;
        return aggregateChartValues(
          matching.map((row) => {
            const value = row[index] ?? null;
            return aggregation === "count" || aggregation === "distinct_count"
              ? value
              : chartMeasure(value, columns[index]?.type);
          }),
          aggregation,
        );
      });
      return {
        field,
        colorValue,
        measureIndex,
        label,
        values,
        total: values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      };
    }),
  );
  if (colorIndex >= 0) {
    const order = legacyPivot
      ? [...new Set(spec.seriesOrder)]
      : spec.seriesOrder;
    const positions = new Map(order?.map((name, index) => [name, index]));
    const rankStack =
      legacyPivot && spec.stacked === true && spec.mark !== "line";
    const groupTotals = new Map(
      series
        .filter(({ measureIndex }) => measureIndex === 0)
        .map(({ colorValue, total }) => [colorValue, total]),
    );
    series.sort((left, right) => {
      const leftLabel = String(left.colorValue ?? "");
      const rightLabel = String(right.colorValue ?? "");
      const explicit =
        (positions.get(leftLabel) ?? positions.size) -
        (positions.get(rightLabel) ?? positions.size);
      if (explicit || !legacyPivot) return explicit || left.total - right.total;
      if (!rankStack || positions.has(leftLabel)) return 0;
      return (
        Number(isCatchAll(leftLabel)) - Number(isCatchAll(rightLabel)) ||
        (groupTotals.get(right.colorValue) ?? 0) -
          (groupTotals.get(left.colorValue) ?? 0)
      );
    });
  }
  const colorField = columns[colorIndex]?.name ?? null;
  const measures = series.map(({ field, colorValue }) => ({
    field,
    colorValue,
  }));
  return {
    columns: [columns[xIndex]?.name ?? "", ...series.map(({ label }) => label)],
    rows: categories.map(({ x }, index) => [
      x,
      ...series.map(({ values }) => values[index] ?? null),
    ]),
    ...(colorField === null
      ? {}
      : {
          colors: pivotSeriesColors(spec, colorField, colorDomain, measures),
        }),
    encoding: {
      ...(legacyBarOrArea ? {} : { timeUnit, aggregation }),
      colorField,
      ...(colorField === null ? {} : { colorDomain }),
      measures,
      ...(countRecords ? { countRecords: true } : {}),
    },
  };
}

function chartMeasure(value: ChartValue, type?: string): ChartValue {
  if (type !== "number") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !DECIMAL.test(value)) return value;
  const projected = Number(value);
  return Number.isFinite(projected) ? projected : value;
}

function isCatchAll(label: string) {
  return /^(other|others|unknown|not set|none|n\/a)$/.test(
    label
      .trim()
      .replace(/^[([{]\s*|\s*[)\]}]$/g, "")
      .toLowerCase(),
  );
}

function dayOfMidnightTimestamp(value: ChartValue): ChartValue {
  if (typeof value !== "string") return value;
  const match = MIDNIGHT_TIMESTAMP.exec(value);
  return match ? match[1]! : value;
}

function calendarDays(values: ChartValue[], timeUnit: ChartTimeUnit | null) {
  if (timeUnit === "day") return values.map(Number);
  if (timeUnit !== null) return [];
  const days: number[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !CALENDAR_DAY.test(value)) return [];
    const date = new Date(`${value}T00:00:00Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      return [];
    days.push(date.getTime());
  }
  return days;
}

function pivotSeriesColors(
  spec: ChartSpec,
  colorField: string,
  domain: readonly ChartValue[],
  measures: ChartEncoding["measures"],
) {
  const labels = [...new Set(domain.map((value) => String(value ?? "")))];
  const slots = new Map(
    [...new Set([...(spec.seriesOrder ?? []), ...labels])].map(
      (label, index) => [label, index],
    ),
  );
  const fields = new Set(measures.map(({ field }) => field));
  const measureOrder = spec.yFields?.filter((field) => fields.has(field)) ?? [];
  const width = Math.max(1, measureOrder.length);
  const series = measures.map(({ field, colorValue }) => {
    const label = String(colorValue ?? "");
    return {
      label,
      slot:
        (slots.get(label) ?? 0) * width +
        Math.max(0, measureOrder.indexOf(field)),
    };
  });
  const visibleSlots = new Set(series.map(({ slot }) => slot));
  for (const label of labels) {
    const start = (slots.get(label) ?? 0) * width;
    for (let slot = start; slot < start + width; slot++) {
      if (!visibleSlots.has(slot)) series.push({ label, slot });
    }
  }
  return resolveSeriesColors({
    labels: series.map(({ label }) => label),
    slots: series.map(({ slot }) => slot),
    colors: spec.colors,
    seriesField: colorField,
  }).slice(0, measures.length);
}

function bucketChartDate(
  value: ChartValue | undefined,
  unit: ChartTimeUnit,
): number | null {
  if (typeof value !== "string") return null;
  const iso = value.replace(" ", "T");
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(iso)
      ? `${iso}Z`
      : iso,
  );
  if (Number.isNaN(date.getTime())) return null;
  switch (unit) {
    case "year":
      date.setUTCMonth(0, 1);
      break;
    case "quarter":
      date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3, 1);
      break;
    case "month":
      date.setUTCDate(1);
      break;
    case "week":
      date.setUTCDate(date.getUTCDate() - date.getUTCDay());
      break;
    case "day":
      break;
    case "hour":
      return date.setUTCMinutes(0, 0, 0);
    case "minute":
      return date.setUTCSeconds(0, 0);
    case "second":
      return date.setUTCMilliseconds(0);
    case "none":
      return date.getTime();
  }
  return date.setUTCHours(0, 0, 0, 0);
}

function aggregateChartValues(
  values: ChartValue[],
  aggregation: ChartAggregation,
): number | null {
  if (aggregation === "count")
    return values.filter((value) => value !== null).length;
  if (aggregation === "distinct_count")
    return new Set(values.filter((value) => value !== null)).size;
  const numbers = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (!numbers.length) return null;
  switch (aggregation) {
    case "none":
      return numbers[0] ?? null;
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
    case "median": {
      numbers.sort((left, right) => left - right);
      const middle = numbers.slice(
        Math.floor((numbers.length - 1) / 2),
        Math.floor(numbers.length / 2) + 1,
      );
      return middle.reduce((sum, value) => sum + value / middle.length, 0);
    }
    case "sum":
    case "average":
    case "variance":
    case "variancepop":
    case "stddev":
    case "stddevpop": {
      const sum = numbers.reduce((total, value) => total + value, 0);
      if (aggregation === "sum") return sum;
      const mean = sum / numbers.length;
      if (aggregation === "average") return mean;
      const count =
        numbers.length -
        (aggregation === "variance" || aggregation === "stddev" ? 1 : 0);
      if (!count) return null;
      const variance =
        numbers.reduce((total, value) => total + (value - mean) ** 2, 0) /
        count;
      return aggregation === "stddev" || aggregation === "stddevpop"
        ? Math.sqrt(variance)
        : variance;
    }
  }
}

function inlineChartDataframe(value: string): ChartDataframeResolution {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { status: "error", reason: "invalidJson" };
  }
  if (!Array.isArray(parsed)) return { status: "error", reason: "invalidRows" };
  if (parsed.length === 0) return { status: "empty" };
  const first: unknown = parsed[0];
  if (first === null || typeof first !== "object" || Array.isArray(first))
    return { status: "error", reason: "invalidRows" };
  const keys = Object.keys(first);
  if (
    keys.length !== 2 ||
    keys.some((key) => ["__proto__", "constructor", "prototype"].includes(key))
  )
    return { status: "error", reason: "invalidRows" };
  const labelField = keys.find(
    (key) => typeof Reflect.get(first, key) === "string",
  );
  const numericField = keys.find(
    (key) =>
      typeof Reflect.get(first, key) === "number" &&
      Number.isFinite(Reflect.get(first, key)),
  );
  if (!labelField || !numericField)
    return { status: "error", reason: "invalidRows" };
  const rows: Array<Array<string | number>> = [];
  for (const row of parsed) {
    if (row === null || typeof row !== "object" || Array.isArray(row))
      return { status: "error", reason: "invalidRows" };
    if (
      Object.keys(row).length !== 2 ||
      !Object.hasOwn(row, labelField) ||
      !Object.hasOwn(row, numericField)
    )
      return { status: "error", reason: "invalidRows" };
    const label: unknown = Reflect.get(row, labelField);
    const numeric: unknown = Reflect.get(row, numericField);
    if (
      typeof label !== "string" ||
      typeof numeric !== "number" ||
      !Number.isFinite(numeric)
    )
      return { status: "error", reason: "invalidRows" };
    rows.push([label, numeric]);
  }
  return {
    status: "ready",
    dataframe: {
      name: value,
      cellId: "",
      columns: [
        {
          name: labelField,
          type: inferredColumnType(rows.map((row) => row[0] ?? null)),
        },
        { name: numericField, type: "number" },
      ],
      rows,
    },
  };
}
