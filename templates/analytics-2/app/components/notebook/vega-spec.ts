import type { ChartMark } from "@/lib/model/contracts";

type Cell = string | number | boolean | null;

export type VegaChartInput = {
  columns: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<Cell>>;
  mark: ChartMark;
  orientation?: "vertical" | "horizontal" | undefined;
  stackMode?: "grouped" | "stacked" | "normalize" | undefined;
  binCount?: number | undefined;
  palette: readonly string[];
  stacked?: boolean | undefined;
  legend?: boolean | undefined;
  tooltipChannels?: boolean | undefined;
  title?: string | null | undefined;
  height?: number | undefined;
  seriesLabels?: Record<string, string> | undefined;
  points?:
    | ReadonlyArray<{ rowIndex: number; seriesIndex: number; value: number }>
    | undefined;
  formatCategory: (value: Cell, rowIndex: number) => string;
  formatValue: (value: number) => string;
  valueFormat?: "number" | "percent" | undefined;
};

export type VegaDatum = {
  x: string;
  series: string;
  value: number;
  label: string;
  rowIndex: number;
  seriesIndex: number;
  pctLabel?: string;
  rawX?: number;
  start?: string | number;
  end?: string | number;
  startLabel?: string;
  endLabel?: string;
};

const VEGA_MARKS = new Set<ChartMark>([
  "bar",
  "line",
  "area",
  "scatter",
  "pie",
  "histogram",
  "combo",
  "heatmap",
  "gantt",
]);

const SIMPLE_MARKS = {
  bar: "bar",
  line: "line",
  area: "area",
  scatter: "point",
  pie: "arc",
} as const;

export function isVegaMark(mark: ChartMark): boolean {
  return VEGA_MARKS.has(mark);
}

export function isGanttRangeCell(value: Cell | undefined): boolean {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    return (
      Number.isFinite(Number(trimmed)) || !Number.isNaN(Date.parse(trimmed))
    );
  }
  return false;
}

function isTemporalCell(value: Cell | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || !Number.isNaN(Number(trimmed))) return false;
  return !Number.isNaN(Date.parse(trimmed));
}

function formatShare(value: number, total: number): string {
  if (!(total > 0)) return "0%";
  const pct = (Math.abs(value) / total) * 100;
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

function baseEnvelope(
  input: VegaChartInput,
  values: VegaDatum[],
  body: Record<string, unknown>,
): Record<string, any> {
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    ...(input.title
      ? {
          title: { text: input.title, limit: { expr: "width" } },
          description: input.title,
        }
      : {}),
    width: "container",
    height: input.height ?? 260,
    autosize: { type: "fit-x", contains: "padding" },
    background: "transparent",
    data: { values },
    ...body,
    config: {
      view: { stroke: null },
      axis: {
        labelColor: "currentColor",
        domainColor: "currentColor",
        gridOpacity: 0.15,
        labelOverlap: true,
      },
      legend: { labelColor: "currentColor", titleColor: "currentColor" },
      title: { color: "currentColor" },
    },
  };
}

function buildHistogramSpec(
  input: VegaChartInput,
  label: (name: string) => string,
  names: string[],
): Record<string, any> {
  const { columns, rows } = input;
  const col0Numeric = rows.some((row) => typeof row[0] === "number");
  const values: VegaDatum[] = [];
  let xTitle: string | null = columns[0] ?? null;

  if (col0Numeric) {
    const seriesName = label(columns[0] ?? "Value");
    rows.forEach((row, rowIndex) => {
      const value = row[0];
      if (typeof value === "number") {
        values.push({
          x: String(value),
          series: seriesName,
          value,
          label: input.formatValue(value),
          rowIndex,
          seriesIndex: 0,
          rawX: value,
        });
      }
    });
  } else if (input.points && input.points.length > 0) {
    xTitle = columns[1] ?? columns[0] ?? null;
    const fallbackSeries = label(xTitle ?? "Value");
    for (const { rowIndex, seriesIndex, value } of input.points) {
      values.push({
        x: String(value),
        series: names[seriesIndex] ?? fallbackSeries,
        value,
        label: input.formatValue(value),
        rowIndex,
        seriesIndex,
        rawX: value,
      });
    }
  } else {
    xTitle = columns[1] ?? columns[0] ?? null;
    rows.forEach((row, rowIndex) => {
      row.slice(1).forEach((value, seriesIndex) => {
        if (typeof value === "number") {
          values.push({
            x: String(value),
            series:
              names[seriesIndex] ?? label(columns[seriesIndex + 1] ?? "Value"),
            value,
            label: input.formatValue(value),
            rowIndex,
            seriesIndex,
            rawX: value,
          });
        }
      });
    });
  }

  const binDef = input.binCount ? { maxbins: input.binCount } : true;
  const tooltip =
    input.tooltipChannels === false
      ? [{ aggregate: "count", type: "quantitative", title: "Count" }]
      : [
          {
            field: "rawX",
            type: "quantitative",
            bin: binDef,
            title: xTitle ?? "Range",
          },
          { aggregate: "count", type: "quantitative", title: "Count" },
        ];

  return baseEnvelope(input, values, {
    mark: { type: "bar", cornerRadiusEnd: 2, tooltip: true },
    encoding: {
      x: {
        field: "rawX",
        type: "quantitative",
        bin: binDef,
        axis: { title: xTitle },
      },
      y: {
        aggregate: "count",
        type: "quantitative",
        axis: { title: "Count" },
      },
      color: { value: input.palette[0] ?? "#4c78a8" },
      tooltip,
    },
    params: [
      {
        name: "pick",
        select: {
          type: "point",
          encodings: ["x"],
          on: "click",
          clear: "dblclick",
        },
      },
    ],
  });
}

function buildGanttSpec(
  input: VegaChartInput,
  label: (name: string) => string,
): Record<string, any> {
  const { columns, rows } = input;
  const hasGroupSeries = columns.length >= 4;
  const validRows = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => isGanttRangeCell(row[1]) && isGanttRangeCell(row[2]));
  const temporal = validRows.some(
    ({ row }) => isTemporalCell(row[1]) || isTemporalCell(row[2]),
  );

  const rawItems = validRows.map(({ row, rowIndex }) => {
    const task = input.formatCategory(row[0] ?? null, rowIndex);
    const groupRaw = hasGroupSeries ? String(row[3] ?? "") : task;
    const series = hasGroupSeries ? label(groupRaw) : task;
    const start = temporal ? String(row[1]).trim() : Number(row[1]);
    const end = temporal ? String(row[2]).trim() : Number(row[2]);
    const startLabel = temporal
      ? String(start)
      : input.formatValue(Number(start));
    const endLabel = temporal ? String(end) : input.formatValue(Number(end));
    const duration = temporal
      ? Date.parse(String(end)) - Date.parse(String(start))
      : Number(end) - Number(start);
    return {
      task,
      series,
      start,
      end,
      startLabel,
      endLabel,
      duration,
      rowIndex,
    };
  });

  const categories = [...new Set(rawItems.map((item) => item.task))];
  const uniqueSeries = [...new Set(rawItems.map((item) => item.series))];
  const values: VegaDatum[] = rawItems.map((item) => ({
    x: item.task,
    series: item.series,
    value: Number.isFinite(item.duration) ? item.duration : 0,
    label: `${item.startLabel} – ${item.endLabel}`,
    rowIndex: item.rowIndex,
    seriesIndex: hasGroupSeries
      ? Math.max(0, uniqueSeries.indexOf(item.series))
      : 0,
    start: item.start,
    end: item.end,
    startLabel: item.startLabel,
    endLabel: item.endLabel,
  }));

  const legendOn =
    input.legend !== false && hasGroupSeries && uniqueSeries.length > 1;
  const color = {
    field: "series",
    type: "nominal",
    scale: {
      domain: uniqueSeries,
      range: uniqueSeries.map(
        (_, i) => input.palette[i % input.palette.length],
      ),
    },
    legend: legendOn ? { orient: "bottom", title: null } : null,
  };
  const tooltip =
    input.tooltipChannels === false
      ? [
          { field: "startLabel", title: columns[1] ?? "Start" },
          { field: "endLabel", title: columns[2] ?? "End" },
        ]
      : [
          { field: "x", title: columns[0] ?? "Task" },
          { field: "startLabel", title: columns[1] ?? "Start" },
          { field: "endLabel", title: columns[2] ?? "End" },
          ...(hasGroupSeries
            ? [{ field: "series", title: columns[3] ?? "Series" }]
            : []),
        ];
  const params: Array<Record<string, unknown>> = [
    {
      name: "pick",
      select: {
        type: "point",
        fields: ["x", "series"],
        on: "click",
        clear: "dblclick",
      },
    },
  ];
  if (legendOn) {
    params.push({
      name: "legendToggle",
      select: { type: "point", fields: ["series"] },
      bind: "legend",
    });
  }

  return baseEnvelope(input, values, {
    mark: { type: "bar", cornerRadius: 3, tooltip: true },
    encoding: {
      y: {
        field: "x",
        type: "nominal",
        sort: categories,
        axis: { title: null },
      },
      x: {
        field: "start",
        type: temporal ? "temporal" : "quantitative",
        axis: { title: null },
      },
      x2: { field: "end" },
      color,
      tooltip,
      ...(legendOn
        ? {
            opacity: {
              condition: { param: "legendToggle", value: 1 },
              value: 0.2,
            },
          }
        : {}),
    },
    params,
  });
}

export function buildVegaSpec(input: VegaChartInput): Record<string, any> {
  const { columns, rows, mark } = input;
  const label = (name: string) =>
    input.seriesLabels && Object.hasOwn(input.seriesLabels, name)
      ? (input.seriesLabels[name] ?? name)
      : name;
  const names = columns.slice(1).map(label);

  if (mark === "histogram") {
    return buildHistogramSpec(input, label, names);
  }
  if (mark === "gantt") {
    return buildGanttSpec(input, label);
  }

  const cells =
    input.points ??
    rows.flatMap((row, rowIndex) =>
      row
        .slice(1)
        .flatMap((value, seriesIndex) =>
          typeof value === "number" ? [{ rowIndex, seriesIndex, value }] : [],
        ),
    );
  const rawValues: VegaDatum[] = cells.map(
    ({ rowIndex, seriesIndex, value }) => ({
      x: input.formatCategory(rows[rowIndex]?.[0] ?? null, rowIndex),
      series: names[seriesIndex] ?? "",
      value,
      label: input.formatValue(value),
      rowIndex,
      seriesIndex,
    }),
  );
  const categories: string[] = [];
  const categoryRowIndex = new Map<string, number>();
  rows.forEach((row, i) => {
    const category = input.formatCategory(row[0] ?? null, i);
    if (!categoryRowIndex.has(category)) {
      categoryRowIndex.set(category, i);
      categories.push(category);
    }
  });
  const multi = names.length > 1;
  const pie = mark === "pie";
  const isNormalized =
    input.stackMode === "normalize" && (mark === "bar" || mark === "area");
  const isStacked =
    input.stackMode === "stacked" ||
    (input.stackMode !== "grouped" &&
      input.stackMode !== "normalize" &&
      (mark === "area" ? input.stacked !== false : input.stacked === true));

  let denseValues = rawValues;
  if (
    (mark === "area" || mark === "bar" || mark === "line") &&
    multi &&
    categories.length > 1
  ) {
    const existing = new Map<string, VegaDatum>();
    for (const datum of rawValues) {
      existing.set(`${datum.x}\0${datum.seriesIndex}`, datum);
    }
    const zeroLabel = input.formatValue(0);
    denseValues = [];
    for (const category of categories) {
      const rowIndex = categoryRowIndex.get(category) ?? 0;
      for (let seriesIndex = 0; seriesIndex < names.length; seriesIndex++) {
        const matched = existing.get(`${category}\0${seriesIndex}`);
        denseValues.push(
          matched ?? {
            x: category,
            series: names[seriesIndex] ?? "",
            value: 0,
            label: zeroLabel,
            rowIndex,
            seriesIndex,
          },
        );
      }
    }
  }

  let values = denseValues;
  if (isNormalized) {
    const totals = new Map<string, number>();
    for (const datum of denseValues) {
      totals.set(datum.x, (totals.get(datum.x) ?? 0) + Math.abs(datum.value));
    }
    values = denseValues.map((datum) => ({
      ...datum,
      pctLabel: formatShare(datum.value, totals.get(datum.x) ?? 0),
    }));
  }

  const fractions = values.every((datum) => Math.abs(datum.value) <= 1);
  const percentAxis =
    input.valueFormat === "percent"
      ? {
          labelExpr: `format(datum.value${fractions ? " * 100" : ""}, ',.2f') + '%'`,
        }
      : {};

  const colorField = pie ? "x" : "series";
  const colorDomain = pie ? categories : names;
  const legendOn = input.legend !== false && (pie || multi);

  const baseTooltip =
    input.tooltipChannels === false
      ? [{ field: "label", title: "Value" }]
      : [
          { field: "x", title: columns[0] ?? "x" },
          ...(multi || mark === "heatmap"
            ? [{ field: "series", title: "Series" }]
            : []),
          { field: "label", title: "Value" },
        ];
  const tooltip = isNormalized
    ? [...baseTooltip, { field: "pctLabel", title: "Share" }]
    : baseTooltip;

  const color = {
    field: colorField,
    type: "nominal",
    scale: {
      domain: colorDomain,
      range: colorDomain.map((_, i) => input.palette[i % input.palette.length]),
    },
    legend: legendOn
      ? { orient: "bottom", title: pie ? (columns[0] ?? null) : null }
      : null,
  };
  const dim = {
    opacity: {
      condition: { param: "legendToggle", value: 1 },
      value: 0.2,
    },
  };
  const opacity = legendOn ? dim : {};
  const pickParam = {
    name: "pick",
    select: {
      type: "point",
      fields: ["x", "series"],
      on: "click",
      clear: "dblclick",
    },
  };
  const legendParam = {
    name: "legendToggle",
    select: { type: "point", fields: [colorField] },
    bind: "legend",
  };

  if (mark === "heatmap") {
    return baseEnvelope(input, values, {
      mark: { type: "rect", tooltip: true },
      encoding: {
        x: {
          field: "x",
          type: "nominal",
          sort: categories,
          axis: { title: null, labelAngle: 0, labelOverlap: true },
        },
        y: {
          field: "series",
          type: "nominal",
          sort: names,
          axis: { title: null },
        },
        color: {
          field: "value",
          type: "quantitative",
          scale: { scheme: "blues" },
          legend:
            input.legend === false ? null : { orient: "bottom", title: null },
        },
        tooltip,
      },
      params: [pickParam],
    });
  }

  if (mark === "combo") {
    const dualAxis = names.length === 2;
    const xEnc = {
      field: "x",
      type: "nominal",
      sort: categories,
      axis: { title: null, labelAngle: 0, labelOverlap: true },
    };
    const barLayer: Record<string, unknown> = {
      transform: [{ filter: "datum.seriesIndex === 0" }],
      mark: { type: "bar", cornerRadiusEnd: 3, tooltip: true },
      encoding: {
        x: xEnc,
        y: {
          field: "value",
          type: "quantitative",
          axis: dualAxis
            ? { title: names[0] ?? null, orient: "left", ...percentAxis }
            : { title: null, ...percentAxis },
        },
        color,
        tooltip,
        ...opacity,
      },
      params: legendOn ? [pickParam, legendParam] : [pickParam],
    };
    const lineLayer: Record<string, unknown> = {
      transform: [
        {
          filter:
            names.length > 1
              ? "datum.seriesIndex > 0"
              : "datum.seriesIndex === 0",
        },
      ],
      mark: { type: "line", point: true, strokeWidth: 2.5, tooltip: true },
      encoding: {
        x: xEnc,
        y: {
          field: "value",
          type: "quantitative",
          axis: dualAxis
            ? { title: names[1] ?? null, orient: "right", ...percentAxis }
            : { title: null, ...percentAxis },
        },
        color,
        tooltip,
        ...opacity,
      },
    };
    return baseEnvelope(input, values, {
      layer: [barLayer, lineLayer],
      ...(dualAxis ? { resolve: { scale: { y: "independent" } } } : {}),
    });
  }

  const params: Array<Record<string, unknown>> = [pickParam];
  if (legendOn) {
    params.push(legendParam);
  }

  const stackValue = isNormalized ? "normalize" : isStacked ? "zero" : null;
  const quantAxis = isNormalized
    ? { title: null, format: "%" }
    : { title: null, ...percentAxis };
  const isHorizontalBar = mark === "bar" && input.orientation === "horizontal";

  let encoding: Record<string, unknown>;
  let markDef: Record<string, unknown>;
  if (pie) {
    markDef = { type: "arc", tooltip: true };
    encoding = {
      theta: { field: "value", type: "quantitative", stack: true },
      color,
      tooltip,
      ...opacity,
    };
  } else if (isHorizontalBar) {
    markDef = { type: "bar", tooltip: true, cornerRadiusEnd: 3 };
    encoding = {
      y: {
        field: "x",
        type: "nominal",
        sort: categories,
        axis: { title: null },
      },
      x: {
        field: "value",
        type: "quantitative",
        stack: stackValue,
        axis: quantAxis,
      },
      color,
      tooltip,
      ...(multi && !isStacked && !isNormalized
        ? { yOffset: { field: "series" } }
        : {}),
      ...opacity,
    };
  } else {
    markDef = {
      type: SIMPLE_MARKS[mark as keyof typeof SIMPLE_MARKS],
      tooltip: true,
    };
    if (mark === "bar") markDef = { ...markDef, cornerRadiusEnd: 3 };
    if (mark === "line") markDef = { ...markDef, point: true };
    const x = {
      field: "x",
      type: "nominal",
      sort: categories,
      axis: { title: null, labelAngle: 0, labelOverlap: true },
    };
    const y = {
      field: "value",
      type: "quantitative",
      stack: mark === "area" || mark === "bar" ? stackValue : null,
      axis:
        mark === "area" || mark === "bar"
          ? quantAxis
          : { title: null, ...percentAxis },
    };
    encoding = {
      x,
      y,
      color,
      tooltip,
      ...(mark === "bar" && multi && !isStacked && !isNormalized
        ? { xOffset: { field: "series" } }
        : {}),
      ...opacity,
    };
  }

  return baseEnvelope(input, values, {
    mark: markDef,
    encoding,
    params,
  });
}
