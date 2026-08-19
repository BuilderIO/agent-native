import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "../utils.js";
import { DataTable } from "./DataTable.js";

const DEFAULT_COLORS = [
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

export interface GenericChartConfig {
  chartType: GenericChartType;
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  colors?: string[];
  stacked?: boolean;
  legend?: boolean;
  description?: string;
  columns?: string[];
  limit?: number;
  formatValue?: (value: number) => string;
  formatXAxis?: (value: string) => string;
  formatSeriesName?: (value: string) => string;
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
  /** App-specific rendering takes priority over the portable Recharts renderer. */
  render?: (context: GenericChartRenderContext<TData, TConfig>) => ReactNode;
  /** Opt into Toolkit's source-agnostic Recharts renderer for row data. */
  chart?: GenericChartConfig;
  renderLoading?: (config: TConfig) => ReactNode;
  renderError?: (error: ReactNode, config: TConfig) => ReactNode;
  renderEmpty?: (config: TConfig) => ReactNode;
  emptyMessage?: ReactNode;
  className?: string;
}

/**
 * A render-only chart state boundary. Data acquisition, query serialization,
 * demos, pivots, and app-specific chart renderers stay with the consuming app.
 */
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

/** Derives chart axes from provider-neutral row data when keys are not configured. */
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
  return String(value ?? "-");
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
    const valueKey = yKeys[0];
    return (
      <ChartCanvas>
        <PieChart>
          <Pie
            data={rows}
            dataKey={valueKey}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            innerRadius={config.chartType === "donut" ? 52 : 0}
            outerRadius={80}
            label={({ name, percent }) =>
              `${seriesFormatter(String(name))} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={false}
          >
            {rows.map((_, index) => (
              <Cell key={index} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: unknown) =>
              formatTooltipValue(value, valueFormatter)
            }
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
      <ChartCanvas>
        <BarChart data={rows}>
          <ChartAxes
            xKey={xKey}
            yFormatter={valueFormatter}
            xFormatter={xFormatter}
          />
          <Tooltip
            formatter={(value: unknown) =>
              formatTooltipValue(value, valueFormatter)
            }
            labelFormatter={(value) => xFormatter(String(value))}
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
              stackId={stacked ? "stack" : undefined}
              radius={stacked && index < yKeys.length - 1 ? 0 : 4}
            />
          ))}
        </BarChart>
      </ChartCanvas>
    );
  }

  const showFill =
    config.chartType === "area" || config.chartType === "stacked-area";
  return (
    <ChartCanvas>
      {showFill ? (
        <AreaChart data={rows}>
          <ChartAxes
            xKey={xKey}
            yFormatter={valueFormatter}
            xFormatter={xFormatter}
          />
          <Tooltip
            formatter={(value: unknown) =>
              formatTooltipValue(value, valueFormatter)
            }
            labelFormatter={(value) => xFormatter(String(value))}
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
              stroke={colors[index % colors.length]}
              fill={colors[index % colors.length]}
              fillOpacity={stacked || yKeys.length === 1 ? 0.25 : 0}
              stackId={stacked ? "stack" : undefined}
            />
          ))}
        </AreaChart>
      ) : (
        <LineChart data={rows}>
          <ChartAxes
            xKey={xKey}
            yFormatter={valueFormatter}
            xFormatter={xFormatter}
          />
          <Tooltip
            formatter={(value: unknown) =>
              formatTooltipValue(value, valueFormatter)
            }
            labelFormatter={(value) => xFormatter(String(value))}
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
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      )}
    </ChartCanvas>
  );
}

function ChartCanvas({ children }: { children: ReactNode }) {
  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function ChartAxes({
  xKey,
  yFormatter,
  xFormatter,
}: {
  xKey: string;
  yFormatter: (value: number) => string;
  xFormatter: (value: string) => string;
}) {
  return (
    <>
      <XAxis
        dataKey={xKey}
        stroke="hsl(var(--muted-foreground))"
        fontSize={12}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value) => xFormatter(String(value))}
      />
      <YAxis
        stroke="hsl(var(--muted-foreground))"
        fontSize={12}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value) => yFormatter(Number(value))}
      />
      <CartesianGrid
        strokeDasharray="3 3"
        stroke="hsl(var(--border))"
        vertical={false}
      />
    </>
  );
}

function formatTooltipValue(
  value: unknown,
  formatter: (value: number) => string,
): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatter(numeric) : String(value ?? "-");
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
