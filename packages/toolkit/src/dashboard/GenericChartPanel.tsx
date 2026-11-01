import type { ComponentProps, ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  DefaultTooltipContent,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipPayloadEntry,
} from "recharts";

import { cn } from "../utils.js";
import { fitAxisLabelToPixelWidth } from "./axis-label-width.js";
import { DataTable } from "./DataTable.js";

const DEFAULT_COLORS: readonly [string, ...string[]] = [
  "hsl(var(--chart-1, 0 0% 20%))",
  "hsl(var(--chart-2, 155 36% 42%))",
  "hsl(var(--chart-3, 32 55% 50%))",
  "hsl(var(--chart-4, 270 25% 55%))",
  "hsl(var(--chart-5, 350 38% 55%))",
  "hsl(var(--chart-6, 190 25% 48%))",
];

export type GenericChartDatum = Record<string, unknown>;
export type GenericChartType =
  | "metric"
  | "line"
  | "area"
  | "bar"
  | "stacked-bar"
  | "stacked-area"
  | "pie"
  | "donut"
  | "table";

export type GenericChartDomainValue = number | "auto" | "dataMin" | "dataMax";
export type GenericChartLabelPosition = "inside" | "top";
export type GenericChartFacetValue = string | boolean;
export type GenericChartYAxisScale = "linear" | "log" | "pow" | "sqrt";
/** A rendered mark click; row is the chart datum, not necessarily a raw source row. */
export interface GenericChartBarMarkClick {
  dataKey: string;
  row: GenericChartDatum;
  rowIndex: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}
export type GenericChartBarMarkClickHandler = (
  click: GenericChartBarMarkClick,
) => void;
export interface GenericChartPieSliceClick {
  row: GenericChartDatum;
  rowIndex: number;
}
export type GenericChartPieSliceClickHandler = (
  click: GenericChartPieSliceClick,
) => void;

export interface GenericChartStyle {
  /** Normalized bar opacity from 0 to 1. */
  opacity?: number | undefined;
  dataLabels?: { perColor?: boolean | undefined } | undefined;
  xAxisTitle?: string | undefined;
  sort?:
    | "ascending"
    | "descending"
    | "y-axis-ascending"
    | "y-axis-descending"
    | undefined;
  gridStyle?: "solid" | "dashed" | "none" | undefined;
  labelAngle?: number | undefined;
  maxLabelLength?: number | undefined;
}

export interface GenericChartConfig {
  chartType: GenericChartType;
  // Recharts horizontal layout keeps categories on X; vertical layout creates horizontal bars.
  layout?: "horizontal" | "vertical" | undefined;
  xKey?: string | undefined;
  yKey?: string | undefined;
  yKeys?: string[] | undefined;
  colors?: string[] | undefined;
  stacked?: boolean | undefined;
  legend?: boolean | undefined;
  description?: string | undefined;
  columns?: string[] | undefined;
  limit?: number | undefined;
  formatValue?: ((value: number) => string) | undefined;
  formatXAxis?: ((value: string) => string) | undefined;
  formatSeriesName?: ((value: string) => string) | undefined;
  xAxisTitle?: string | undefined;
  yAxisTitle?: string | undefined;
  yAxisScale?: GenericChartYAxisScale | undefined;
  pieLabelsAsPercentage?: boolean | undefined;
  showTooltip?: boolean | undefined;
  tooltipFields?: string[] | undefined;
  tooltipFieldLabels?: Record<string, string> | undefined;
  horizontalFacet?: string | undefined;
  verticalFacet?: string | undefined;
  barValueLabelPosition?: GenericChartLabelPosition | undefined;
  barTotalLabelPosition?: GenericChartLabelPosition | undefined;
  areaLineEnabled?: boolean | undefined;
  areaPointsEnabled?: boolean | undefined;
  areaDataLabelFormatter?: ((value: number) => string) | undefined;
  areaDataLabelAngle?: number | undefined;
  areaDataLabelFontSize?: number | undefined;
  areaDataLabelColor?: string | undefined;
  lineDataLabelFormatter?: ((value: number) => string) | undefined;
  lineDataLabelPosition?: "inside" | "top" | undefined;
  lineDataLabelAngle?: number | undefined;
  lineDataLabelFontSize?: number | undefined;
  lineDataLabelColor?: string | undefined;
  linePointsEnabled?: boolean | undefined;
  lineSeriesWidth?: number | undefined;
  referenceLineXValues?: number[] | undefined;
  style?: GenericChartStyle | undefined;
  yDomain?:
    | readonly [GenericChartDomainValue, GenericChartDomainValue]
    | undefined;
  yAxisTicks?: number[] | undefined;
  onBarMarkClick?: GenericChartBarMarkClickHandler | undefined;
  onPieSliceClick?: GenericChartPieSliceClickHandler | undefined;
  plotMargin?:
    | Partial<{
        top: number | undefined;
        right: number | undefined;
        bottom: number | undefined;
        left: number | undefined;
      }>
    | undefined;
  barCategoryGap?: string | number | undefined;
  /** Canvas height in pixels; defaults to 250. */
  height?: number | undefined;
  /** Plot top margin in pixels, applied on top of `plotMargin`. */
  topPadding?: number | undefined;
  yAxisTickCount?: number | undefined;
  verticalGrid?: boolean | undefined;
  /** Print each bar segment's value on the bar. */
  showBarValues?: boolean | undefined;
}

export interface GenericChartRenderContext<TData, TConfig> {
  data: TData;
  config: TConfig;
}

export interface GenericChartPanelProps<TData, TConfig> {
  data: TData | null | undefined;
  config: TConfig;
  loading?: boolean;
  error?: ReactNode;
  isEmpty?: (data: TData) => boolean;
  render?: (context: GenericChartRenderContext<TData, TConfig>) => ReactNode;
  chart?: GenericChartConfig;
  renderLoading?: (config: TConfig) => ReactNode;
  renderError?: (error: ReactNode, config: TConfig) => ReactNode;
  renderEmpty?: (config: TConfig) => ReactNode;
  emptyMessage?: ReactNode;
  className?: string;
}

export function GenericChartPanel<TData, TConfig>({
  data,
  config,
  loading = false,
  error,
  isEmpty,
  render,
  chart,
  renderLoading,
  renderError,
  renderEmpty,
  emptyMessage = "No data available.",
  className,
}: GenericChartPanelProps<TData, TConfig>) {
  if (loading) {
    return (
      <>
        {renderLoading?.(config) ?? (
          <ChartPanelPlaceholder className={className} />
        )}
      </>
    );
  }

  if (error) {
    return (
      <>
        {renderError?.(error, config) ?? (
          <ChartPanelMessage className={className} tone="error">
            {error}
          </ChartPanelMessage>
        )}
      </>
    );
  }

  if (data == null || isEmpty?.(data)) {
    return (
      <>
        {renderEmpty?.(config) ?? (
          <ChartPanelMessage className={className}>
            {emptyMessage}
          </ChartPanelMessage>
        )}
      </>
    );
  }

  if (render) return <>{render({ data, config })}</>;
  if (chart && Array.isArray(data)) {
    return (
      <GenericChartRenderer rows={data as GenericChartDatum[]} config={chart} />
    );
  }

  return null;
}

export function resolveGenericChartKeys(
  rows: GenericChartDatum[],
  config: Pick<GenericChartConfig, "xKey" | "yKey" | "yKeys">,
): { xKey: string; yKeys: string[] } {
  const columns = Object.keys(rows[0] ?? {});
  const xKey =
    config.xKey && columns.includes(config.xKey)
      ? config.xKey
      : (columns[0] ?? "");
  const configured = (
    config.yKeys?.length ? config.yKeys : config.yKey ? [config.yKey] : []
  ).filter((key) => columns.includes(key));
  const yKeys = configured.length
    ? configured
    : columns.filter((key) => key !== xKey && isNumericLike(rows[0]?.[key]));
  return {
    xKey,
    yKeys: yKeys.length
      ? yKeys
      : columns.filter((key) => key !== xKey).slice(0, 1),
  };
}

export function formatGenericChartValue(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString();
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value).toLocaleString();
  }
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : typeof value === "string" || typeof value === "number"
      ? String(value)
      : "-";
}

function isNumericLike(value: unknown): boolean {
  return (
    typeof value === "number" ||
    (typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value)))
  );
}

export function GenericChartRenderer({
  rows,
  config,
}: {
  rows: GenericChartDatum[];
  config: GenericChartConfig;
}) {
  const { xKey, yKeys } = resolveGenericChartKeys(rows, config);
  const colors = config.colors?.length ? config.colors : DEFAULT_COLORS;
  const valueFormatter = config.formatValue ?? formatGenericChartValue;
  const xFormatter = config.formatXAxis ?? ((value: string) => value);
  const seriesFormatter = config.formatSeriesName ?? ((value: string) => value);
  const plotMargin = resolveChartMargin(
    config.topPadding === undefined
      ? config.plotMargin
      : { ...config.plotMargin, top: config.topPadding },
  );
  const axisGrid = {
    yAxisTickCount: config.yAxisTickCount,
    verticalGrid: config.verticalGrid,
  };

  if (config.horizontalFacet || config.verticalFacet) {
    const horizontalValues = config.horizontalFacet
      ? resolveFacetValues(rows, config.horizontalFacet)
      : undefined;
    const verticalValues = config.verticalFacet
      ? resolveFacetValues(rows, config.verticalFacet)
      : undefined;

    if (
      (config.horizontalFacet && !horizontalValues) ||
      (config.verticalFacet && !verticalValues) ||
      (config.horizontalFacet &&
        config.horizontalFacet === config.verticalFacet)
    ) {
      return (
        <ChartPanelMessage tone="error">
          Chart facets need distinct fields with text or boolean values.
        </ChartPanelMessage>
      );
    }

    return (
      <FacetedCharts
        rows={rows}
        config={config}
        horizontalValues={horizontalValues}
        verticalValues={verticalValues}
      />
    );
  }

  if (config.chartType === "metric") {
    const valueKey =
      config.yKey && xKey !== config.yKey ? config.yKey : (yKeys[0] ?? xKey);
    const first = rows[0]?.[valueKey];
    const raw =
      rows.length > 1 && rows.every((row) => isNumericLike(row[valueKey]))
        ? rows.reduce((sum, row) => sum + Number(row[valueKey]), 0)
        : first;
    const value = isNumericLike(raw)
      ? valueFormatter(Number(raw))
      : formatGenericChartValue(raw);
    return (
      <div className="flex min-h-12 flex-1 flex-col items-center justify-center py-2 text-center">
        <div className="text-3xl font-bold">{value}</div>
        {config.description && (
          <p className="mt-1 text-xs text-muted-foreground">
            {config.description}
          </p>
        )}
      </div>
    );
  }

  if (config.chartType === "table") {
    return (
      <DataTable data={rows} columns={config.columns} maxRows={config.limit} />
    );
  }

  if (!xKey || yKeys.length === 0) {
    return (
      <ChartPanelMessage>
        Chart data needs an x-axis and at least one value column.
      </ChartPanelMessage>
    );
  }

  if (config.chartType === "pie" || config.chartType === "donut") {
    const valueKey = yKeys.at(0) ?? xKey;
    const total = rows.reduce((sum, row) => {
      const value = row[valueKey];
      return (
        sum + (typeof value === "number" && Number.isFinite(value) ? value : 0)
      );
    }, 0);
    const percentageForRow = (row: GenericChartDatum | undefined) => {
      const value = row?.[valueKey];
      return typeof value === "number" &&
        Number.isFinite(value) &&
        Number.isFinite(total) &&
        total > 0
        ? value / total
        : null;
    };
    return (
      <ChartCanvas height={config.height}>
        <PieChart {...(plotMargin === undefined ? {} : { margin: plotMargin })}>
          <Pie
            data={rows}
            dataKey={valueKey}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            innerRadius={config.chartType === "donut" ? 52 : 0}
            outerRadius={80}
            label={({ name, percent, value }) =>
              config.pieLabelsAsPercentage === false
                ? formatTooltipValue(value, valueFormatter)
                : `${seriesFormatter(String(name))} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={false}
            onClick={
              config.onPieSliceClick
                ? (_sector, rowIndex) => {
                    const row = rows.at(rowIndex);
                    if (row) config.onPieSliceClick?.({ row, rowIndex });
                  }
                : undefined
            }
          >
            {rows.map((_, index) => (
              <Cell key={index} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <ChartTooltip
            fields={config.tooltipFields}
            fieldLabels={config.tooltipFieldLabels}
            labelField={xKey}
            percentageForRow={percentageForRow}
            show={config.showTooltip}
            valueFormatter={valueFormatter}
          />
          {config.legend !== false && (
            <Legend formatter={(value) => seriesFormatter(String(value))} />
          )}
        </PieChart>
      </ChartCanvas>
    );
  }

  const stacked =
    config.stacked ||
    config.chartType === "stacked-bar" ||
    config.chartType === "stacked-area";
  if (config.chartType === "bar" || config.chartType === "stacked-bar") {
    return (
      <ChartCanvas height={config.height}>
        <BarChart
          {...(config.barCategoryGap === undefined
            ? {}
            : { barCategoryGap: config.barCategoryGap })}
          data={rows}
          {...(config.layout === undefined ? {} : { layout: config.layout })}
          {...(plotMargin === undefined ? {} : { margin: plotMargin })}
        >
          <ChartAxes
            xKey={xKey}
            xTitle={config.xAxisTitle}
            maxLabelLength={config.style?.maxLabelLength}
            yFormatter={valueFormatter}
            yDomain={config.yDomain}
            yAxisScale={
              config.layout === "vertical" ? undefined : config.yAxisScale
            }
            yAxisTicks={config.yAxisTicks}
            yTitle={config.yAxisTitle}
            xFormatter={xFormatter}
            {...axisGrid}
          />
          <ChartTooltip
            fields={config.tooltipFields}
            fieldLabels={config.tooltipFieldLabels}
            labelField={xKey}
            labelFormatter={(value) => xFormatter(String(value))}
            show={config.showTooltip}
            valueFormatter={valueFormatter}
          />
          {config.legend !== false && (
            <Legend formatter={(value) => seriesFormatter(String(value))} />
          )}
          {yKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              name={seriesFormatter(key)}
              fill={colors[index % colors.length]}
              opacity={config.style?.opacity}
              stackId={stacked ? "stack" : undefined}
              onClick={
                config.onBarMarkClick
                  ? (data, rowIndex, event) =>
                      config.onBarMarkClick?.({
                        dataKey: key,
                        row: data.payload as GenericChartDatum,
                        rowIndex,
                        altKey: event.altKey,
                        ctrlKey: event.ctrlKey,
                        metaKey: event.metaKey,
                        shiftKey: event.shiftKey,
                      })
                  : undefined
              }
              radius={stacked && index < yKeys.length - 1 ? 0 : 4}
            >
              {config.showBarValues ? (
                <LabelList
                  dataKey={key}
                  formatter={(value) =>
                    formatTooltipValue(value, valueFormatter)
                  }
                  position={stacked ? "center" : "top"}
                />
              ) : config.chartType === "bar" &&
                !stacked &&
                yKeys.length === 1 ? (
                [config.barValueLabelPosition, config.barTotalLabelPosition]
                  .filter(
                    (
                      position,
                      positionIndex,
                      positions,
                    ): position is GenericChartLabelPosition =>
                      position !== undefined &&
                      positions.indexOf(position) === positionIndex,
                  )
                  .map((position) => (
                    <LabelList
                      key={position}
                      dataKey={key}
                      formatter={(value) =>
                        formatTooltipValue(value, valueFormatter)
                      }
                      position={position}
                    />
                  ))
              ) : null}
            </Bar>
          ))}
        </BarChart>
      </ChartCanvas>
    );
  }

  const showFill =
    config.chartType === "area" || config.chartType === "stacked-area";
  return (
    <ChartCanvas height={config.height}>
      {showFill ? (
        <AreaChart
          data={rows}
          {...(plotMargin === undefined ? {} : { margin: plotMargin })}
        >
          <ChartAxes
            xKey={xKey}
            xTitle={config.xAxisTitle}
            maxLabelLength={config.style?.maxLabelLength}
            yFormatter={valueFormatter}
            yDomain={config.yDomain}
            yAxisScale={config.yAxisScale}
            yAxisTicks={config.yAxisTicks}
            yTitle={config.yAxisTitle}
            xFormatter={xFormatter}
            {...axisGrid}
          />
          <ChartTooltip
            fields={config.tooltipFields}
            fieldLabels={config.tooltipFieldLabels}
            labelField={xKey}
            labelFormatter={(value) => xFormatter(String(value))}
            show={config.showTooltip}
            valueFormatter={valueFormatter}
          />
          {config.legend !== false && (
            <Legend formatter={(value) => seriesFormatter(String(value))} />
          )}
          {yKeys.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={seriesFormatter(key)}
              stroke={
                config.areaLineEnabled === false
                  ? "none"
                  : colors[index % colors.length]
              }
              fill={colors[index % colors.length]}
              fillOpacity={stacked || yKeys.length === 1 ? 0.25 : 0}
              stackId={stacked ? "stack" : undefined}
              dot={config.areaPointsEnabled ?? false}
            >
              {config.areaDataLabelFormatter ? (
                <LabelList
                  dataKey={key}
                  {...(config.areaDataLabelAngle === undefined
                    ? {}
                    : { angle: config.areaDataLabelAngle })}
                  {...(config.areaDataLabelColor === undefined
                    ? {}
                    : { fill: config.areaDataLabelColor })}
                  {...(config.areaDataLabelFontSize === undefined
                    ? {}
                    : { fontSize: config.areaDataLabelFontSize })}
                  formatter={(value) =>
                    typeof value === "number"
                      ? (config.areaDataLabelFormatter?.(value) ?? "")
                      : ""
                  }
                />
              ) : null}
            </Area>
          ))}
        </AreaChart>
      ) : (
        <LineChart
          data={rows}
          {...(plotMargin === undefined ? {} : { margin: plotMargin })}
        >
          <ChartAxes
            xKey={xKey}
            xTitle={config.xAxisTitle}
            maxLabelLength={config.style?.maxLabelLength}
            yFormatter={valueFormatter}
            yDomain={config.yDomain}
            yAxisScale={config.yAxisScale}
            yAxisTicks={config.yAxisTicks}
            yTitle={config.yAxisTitle}
            xFormatter={xFormatter}
            {...axisGrid}
          />
          <ChartTooltip
            fields={config.tooltipFields}
            fieldLabels={config.tooltipFieldLabels}
            labelField={xKey}
            labelFormatter={(value) => xFormatter(String(value))}
            show={config.showTooltip}
            valueFormatter={valueFormatter}
          />
          {config.legend !== false && (
            <Legend formatter={(value) => seriesFormatter(String(value))} />
          )}
          {yKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={seriesFormatter(key)}
              stroke={colors[index % colors.length]}
              strokeWidth={config.lineSeriesWidth ?? 2}
              dot={config.linePointsEnabled ?? false}
            >
              {config.lineDataLabelFormatter ? (
                <LabelList
                  dataKey={key}
                  {...(config.lineDataLabelAngle === undefined
                    ? {}
                    : { angle: config.lineDataLabelAngle })}
                  fill={
                    config.lineDataLabelColor ??
                    colors.at(index % colors.length) ??
                    DEFAULT_COLORS[0]
                  }
                  {...(config.lineDataLabelFontSize === undefined
                    ? {}
                    : { fontSize: config.lineDataLabelFontSize })}
                  formatter={(value) =>
                    typeof value === "number"
                      ? (config.lineDataLabelFormatter?.(value) ?? "")
                      : ""
                  }
                  position={config.lineDataLabelPosition ?? "top"}
                />
              ) : null}
            </Line>
          ))}
          {config.referenceLineXValues?.map((value, index) => (
            <ReferenceLine
              key={`${value}-${index}`}
              x={value}
              stroke="hsl(var(--muted-foreground))"
            />
          ))}
        </LineChart>
      )}
    </ChartCanvas>
  );
}

function ChartCanvas({
  children,
  height = 250,
}: {
  children: ReactNode;
  height?: number | undefined;
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function resolveChartMargin(
  margin: GenericChartConfig["plotMargin"],
): { top: number; right: number; bottom: number; left: number } | undefined {
  if (!margin) return undefined;
  return {
    top: margin.top ?? 5,
    right: margin.right ?? 5,
    bottom: margin.bottom ?? 5,
    left: margin.left ?? 5,
  };
}

type NumericChartScale = ((value: number) => number | undefined) & {
  domain: {
    (): readonly number[];
    (domain: readonly number[]): NumericChartScale;
  };
  range: {
    (): readonly number[];
    (range: readonly number[]): NumericChartScale;
  };
  copy: () => NumericChartScale;
  ticks: (count: number | undefined) => readonly number[];
  invert: (value: number) => number | undefined;
};

function signedPower(value: number, exponent: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), exponent);
}

function createPowerScale(exponent: number): NumericChartScale {
  let domain: readonly number[] = [0, 1];
  let range: readonly number[] = [0, 1];
  const scale = ((value: number) => {
    const start = signedPower(domain[0] ?? 0, exponent);
    const end = signedPower(domain[1] ?? 1, exponent);
    const span = end - start;
    if (span === 0) return ((range[0] ?? 0) + (range[1] ?? 1)) / 2;
    return (
      (range[0] ?? 0) +
      ((signedPower(value, exponent) - start) / span) *
        ((range[1] ?? 1) - (range[0] ?? 0))
    );
  }) as NumericChartScale;

  scale.domain = ((next?: readonly number[]) => {
    if (next === undefined) return domain;
    domain = [next[0] ?? 0, next[1] ?? 1];
    return scale;
  }) as NumericChartScale["domain"];
  scale.range = ((next?: readonly number[]) => {
    if (next === undefined) return range;
    range = [next[0] ?? 0, next[1] ?? 1];
    return scale;
  }) as NumericChartScale["range"];
  scale.copy = () => createPowerScale(exponent).domain(domain).range(range);
  scale.ticks = (count) => {
    const minimum = domain[0] ?? 0;
    const maximum = domain[1] ?? 1;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [];
    if (minimum === maximum) return [minimum];
    const divisions = Math.max(1, Math.floor(count ?? 5) - 1);
    return Array.from(
      { length: divisions + 1 },
      (_, index) => minimum + ((maximum - minimum) * index) / divisions,
    );
  };
  scale.invert = (value) => {
    const start = signedPower(domain[0] ?? 0, exponent);
    const end = signedPower(domain[1] ?? 1, exponent);
    const rangeSpan = (range[1] ?? 1) - (range[0] ?? 0);
    if (rangeSpan === 0) return undefined;
    const transformed =
      start + ((value - (range[0] ?? 0)) / rangeSpan) * (end - start);
    return signedPower(transformed, 1 / exponent);
  };
  return scale;
}

function resolveLogDomain(
  domain:
    | readonly [GenericChartDomainValue, GenericChartDomainValue]
    | undefined,
): readonly [GenericChartDomainValue, GenericChartDomainValue] {
  return [
    domain?.[0] === undefined || domain[0] === "auto" ? "dataMin" : domain[0],
    domain?.[1] === undefined || domain[1] === "auto" ? "dataMax" : domain[1],
  ];
}

function resolveFacetValues(
  rows: GenericChartDatum[],
  field: string,
): GenericChartFacetValue[] | undefined {
  const values = rows.map((row) => row[field]);
  if (
    values.length === 0 ||
    !values.every(
      (value): value is GenericChartFacetValue =>
        typeof value === "string" || typeof value === "boolean",
    )
  ) {
    return undefined;
  }
  return [...new Set(values)];
}

function FacetedCharts({
  rows,
  config,
  horizontalValues,
  verticalValues,
}: {
  rows: GenericChartDatum[];
  config: GenericChartConfig;
  horizontalValues?: GenericChartFacetValue[] | undefined;
  verticalValues?: GenericChartFacetValue[] | undefined;
}) {
  const horizontalFacet = config.horizontalFacet;
  const verticalFacet = config.verticalFacet;
  const horizontalPanels = horizontalValues ?? [undefined];
  const verticalPanels = verticalValues ?? [undefined];
  const panelConfig = {
    ...config,
    horizontalFacet: undefined,
    verticalFacet: undefined,
  };

  return (
    <div
      className="grid w-full gap-4"
      style={{
        gridTemplateColumns: `repeat(${horizontalValues?.length ?? 1}, minmax(0, 1fr))`,
      }}
    >
      {verticalPanels.flatMap((verticalValue, verticalIndex) =>
        horizontalPanels.map((horizontalValue, horizontalIndex) => {
          const panelRows = rows.filter(
            (row) =>
              (verticalFacet === undefined ||
                row[verticalFacet] === verticalValue) &&
              (horizontalFacet === undefined ||
                row[horizontalFacet] === horizontalValue),
          );
          const label = [
            verticalFacet === undefined
              ? undefined
              : `${verticalFacet}: ${formatGenericChartValue(verticalValue)}`,
            horizontalFacet === undefined
              ? undefined
              : `${horizontalFacet}: ${formatGenericChartValue(horizontalValue)}`,
          ]
            .filter((part): part is string => part !== undefined)
            .join(" · ");

          return (
            <section
              className="min-w-0"
              key={`facet-${verticalIndex}-${horizontalIndex}`}
            >
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                {label}
              </h3>
              {panelRows.length ? (
                <GenericChartRenderer rows={panelRows} config={panelConfig} />
              ) : (
                <ChartPanelMessage>No data available.</ChartPanelMessage>
              )}
            </section>
          );
        }),
      )}
    </div>
  );
}

function ChartTooltip({
  fields,
  fieldLabels,
  labelField,
  labelFormatter,
  percentageForRow,
  show,
  valueFormatter,
}: {
  fields?: string[] | undefined;
  fieldLabels?: Record<string, string> | undefined;
  labelField: string;
  labelFormatter?: ((value: ReactNode) => ReactNode) | undefined;
  percentageForRow?:
    | ((row: GenericChartDatum | undefined) => number | null)
    | undefined;
  show?: boolean | undefined;
  valueFormatter: (value: number) => string;
}) {
  if (show === false) return null;

  const tooltipValueFormatter = (
    value: unknown,
    _name: unknown,
    item?: TooltipPayloadEntry,
  ) => {
    const formattedValue = formatTooltipValue(value, valueFormatter);
    const sourceRow =
      typeof item?.payload === "object" && item.payload !== null
        ? (item.payload as GenericChartDatum)
        : undefined;
    const percentage = percentageForRow?.(sourceRow);
    return percentage === null ||
      percentage === undefined ||
      !Number.isFinite(percentage)
      ? formattedValue
      : `${formattedValue} (${formatPiePercentage(percentage)})`;
  };

  const content =
    fields === undefined
      ? undefined
      : (props: TooltipContentProps) => {
          const selected = new Set(fields);
          const payload = props.payload.filter(
            (item) =>
              (typeof item.dataKey === "string" &&
                selected.has(item.dataKey)) ||
              (typeof item.nameKey === "string" && selected.has(item.nameKey)),
          );
          const sourceRow = props.payload.find(
            (item) => typeof item.payload === "object" && item.payload !== null,
          )?.payload as GenericChartDatum | undefined;
          const plottedFields = new Set(
            props.payload.flatMap((item) =>
              [item.dataKey, item.nameKey].filter(
                (key): key is string => typeof key === "string",
              ),
            ),
          );
          const customFields = fields.flatMap((field, index) => {
            const value = sourceRow?.[field];
            if (
              field === labelField ||
              plottedFields.has(field) ||
              value === undefined ||
              value === null
            ) {
              return [];
            }

            return [
              {
                dataKey: field,
                graphicalItemId: `custom-tooltip-${index}`,
                name: fieldLabels?.[field] ?? field,
                payload: sourceRow,
                value:
                  typeof value === "number" || typeof value === "string"
                    ? value
                    : formatGenericChartValue(value),
              } satisfies TooltipPayloadEntry,
            ];
          });
          const showLabel = selected.has(labelField);
          const tooltipPayload = [...payload, ...customFields];
          if (!props.active || (!tooltipPayload.length && !showLabel)) {
            return null;
          }

          return (
            <DefaultTooltipContent
              {...(labelFormatter === undefined ? {} : { labelFormatter })}
              formatter={tooltipValueFormatter}
              {...(showLabel && props.label !== undefined
                ? { label: props.label }
                : {})}
              payload={tooltipPayload}
            />
          );
        };

  return (
    <Tooltip
      {...(content === undefined ? {} : { content })}
      formatter={tooltipValueFormatter}
      {...(labelFormatter === undefined ? {} : { labelFormatter })}
    />
  );
}

function ChartAxes({
  xKey,
  xTitle,
  maxLabelLength,
  yFormatter,
  yDomain,
  yAxisScale,
  yAxisTicks,
  yTitle,
  xFormatter,
  yAxisTickCount,
  verticalGrid,
}: {
  xKey: string;
  xTitle?: string;
  maxLabelLength?: number;
  yFormatter: (value: number) => string;
  yDomain?: readonly [GenericChartDomainValue, GenericChartDomainValue];
  yAxisScale?: GenericChartYAxisScale;
  yAxisTicks?: number[];
  yTitle?: string;
  xFormatter: (value: string) => string;
  yAxisTickCount?: number;
  verticalGrid?: boolean;
}) {
  const axisDomain = yAxisScale === "log" ? resolveLogDomain(yDomain) : yDomain;
  const axisScale = yAxisScale === "pow" ? createPowerScale(2) : yAxisScale;
  return (
    <>
      <XAxis
        dataKey={xKey}
        stroke="hsl(var(--muted-foreground))"
        fontSize={12}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value) =>
          fitAxisLabelToPixelWidth(
            xFormatter(String(value)),
            maxLabelLength,
            12,
          )
        }
        label={
          xTitle
            ? { value: xTitle, position: "insideBottom", offset: -8 }
            : undefined
        }
      />
      <YAxis
        stroke="hsl(var(--muted-foreground))"
        fontSize={12}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value) => yFormatter(Number(value))}
        domain={axisDomain}
        scale={axisScale as NonNullable<ComponentProps<typeof YAxis>["scale"]>}
        ticks={yAxisTicks}
        tickCount={yAxisTickCount}
        allowDataOverflow={axisDomain !== undefined}
        label={
          yTitle
            ? { value: yTitle, angle: -90, position: "insideLeft" }
            : undefined
        }
      />
      <CartesianGrid
        strokeDasharray="3 3"
        stroke="hsl(var(--border))"
        vertical={verticalGrid ?? false}
      />
    </>
  );
}

function formatTooltipValue(
  value: unknown,
  formatter: (value: number) => string,
): string {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? formatter(numeric)
    : typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : typeof value === "string" || typeof value === "number"
        ? String(value)
        : "-";
}

function formatPiePercentage(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "percent" }).format(value);
}

export function ChartPanelPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "min-h-[250px] w-full animate-pulse rounded-md bg-muted",
        className,
      )}
    />
  );
}

function ChartPanelMessage({
  children,
  className,
  tone = "muted",
}: {
  children: ReactNode;
  className?: string;
  tone?: "error" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex min-h-[250px] items-center justify-center px-4 py-8 text-center text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
