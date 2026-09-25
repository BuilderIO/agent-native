import {
  ChartContainer,
  type ChartConfig,
} from "@agent-native/toolkit/ui/chart";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useT } from "../../i18n.js";
import { seriesId, USAGE_OTHER_KEY, type UsageSeries } from "./usage-model.js";

// Each series keeps the color slot of its rank, and "other" is always muted.
const SERIES_COLORS = [
  "hsl(var(--chart-1, var(--primary)))",
  "hsl(var(--chart-2, 155 36% 42%))",
  "hsl(var(--chart-3, 32 55% 50%))",
  "hsl(var(--chart-4, 270 25% 55%))",
  "hsl(var(--chart-5, 350 38% 55%))",
  "hsl(var(--chart-6, 190 25% 48%))",
];
const OTHER_COLOR = "hsl(var(--muted-foreground) / 0.55)";

export function seriesColor(series: UsageSeries, index: number): string {
  return series.keys[index] === USAGE_OTHER_KEY
    ? OTHER_COLOR
    : SERIES_COLORS[index % SERIES_COLORS.length]!;
}

interface ChartFormatters {
  /** A series name for the legend and tooltip. */
  name: (key: string) => string;
  /** A value in the tooltip and legend. */
  value: (value: number) => string;
  /** A y-axis tick. */
  tick: (value: number) => string;
  /** An x-axis or tooltip date. */
  date: (date: string) => string;
  /** A share of the total, from 0 to 1. */
  share: (fraction: number) => string;
}

function useChartConfig(series: UsageSeries, name: ChartFormatters["name"]) {
  return useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        series.keys.map((key, index) => [
          seriesId(index),
          { label: name(key), color: seriesColor(series, index) },
        ]),
      ),
    [name, series],
  );
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

function UsageTooltip({
  active,
  payload,
  label,
  formatters,
  series,
  showTotal,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  formatters: ChartFormatters;
  series: UsageSeries;
  showTotal: boolean;
}) {
  const t = useT();
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((entry) => Number(entry.value) > 0)
    .slice()
    .reverse();
  const total = payload.reduce((sum, entry) => sum + Number(entry.value), 0);
  return (
    <div className="grid min-w-36 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl">
      <div className="text-muted-foreground">
        {formatters.date(String(label))}
      </div>
      {rows.map((entry) => {
        const index = Number(String(entry.dataKey).slice(1));
        return (
          <div key={String(entry.dataKey)} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-0.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="font-medium tabular-nums text-foreground">
              {formatters.value(Number(entry.value))}
            </span>
            <span className="min-w-0 truncate text-muted-foreground">
              {formatters.name(series.keys[index] ?? "")}
            </span>
          </div>
        );
      })}
      {showTotal && rows.length > 1 ? (
        <div className="flex items-center gap-2 border-t border-border/60 pt-1.5">
          <span aria-hidden="true" className="w-2.5 shrink-0" />
          <span className="font-medium tabular-nums text-foreground">
            {formatters.value(total)}
          </span>
          <span className="text-muted-foreground">
            {t("agentChat.settings.usage.total")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  fontSize: 12,
} as const;

/** Stacked daily bars, one segment per series. */
export function UsageBarChart({
  series,
  formatters,
  label,
}: {
  series: UsageSeries;
  formatters: ChartFormatters;
  label: string;
}) {
  const config = useChartConfig(series, formatters.name);
  const lastIndex = series.keys.length - 1;
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-60 w-full"
      role="img"
      aria-label={label}
    >
      <BarChart
        data={series.rows}
        margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
        maxBarSize={24}
      >
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          {...AXIS_PROPS}
          dataKey="date"
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatters.date}
        />
        <YAxis {...AXIS_PROPS} width={56} tickFormatter={formatters.tick} />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))" }}
          isAnimationActive={false}
          content={(props) => (
            <UsageTooltip
              active={props.active}
              payload={props.payload as readonly TooltipEntry[] | undefined}
              label={props.label as string | number | undefined}
              formatters={formatters}
              series={series}
              showTotal
            />
          )}
        />
        {series.keys.map((key, index) => (
          <Bar
            key={key}
            dataKey={seriesId(index)}
            stackId="usage"
            fill={seriesColor(series, index)}
            radius={index === lastIndex ? [4, 4, 0, 0] : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** One line per series of daily counts. */
export function UsageLineChart({
  series,
  formatters,
  label,
}: {
  series: UsageSeries;
  formatters: ChartFormatters;
  label: string;
}) {
  const config = useChartConfig(series, formatters.name);
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-60 w-full"
      role="img"
      aria-label={label}
    >
      <LineChart
        data={series.rows}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          {...AXIS_PROPS}
          dataKey="date"
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatters.date}
        />
        <YAxis
          {...AXIS_PROPS}
          width={44}
          allowDecimals={false}
          tickFormatter={formatters.tick}
        />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
          isAnimationActive={false}
          content={(props) => (
            <UsageTooltip
              active={props.active}
              payload={props.payload as readonly TooltipEntry[] | undefined}
              label={props.label as string | number | undefined}
              formatters={formatters}
              series={series}
              showTotal={false}
            />
          )}
        />
        {series.keys.map((key, index) => (
          <Line
            key={key}
            dataKey={seriesId(index)}
            type="linear"
            stroke={seriesColor(series, index)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

/**
 * The legend doubles as the value table: every series with its share of the
 * total (bars) or its total (lines).
 */
export function UsageLegend({
  series,
  formatters,
  shares,
}: {
  series: UsageSeries;
  formatters: Pick<ChartFormatters, "name" | "value" | "share">;
  shares: boolean;
}) {
  return (
    <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-5 gap-y-3">
      {series.totals.map((entry, index) => {
        const share = series.total > 0 ? entry.value / series.total : 0;
        return (
          <li key={entry.key} className="flex min-w-0 gap-2.5">
            <span
              aria-hidden="true"
              className={
                shares
                  ? "w-[3px] shrink-0 rounded-full"
                  : "h-0.5 w-3.5 shrink-0 self-center rounded-full"
              }
              style={{ backgroundColor: seriesColor(series, index) }}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs text-muted-foreground">
                {formatters.name(entry.key)}
              </span>
              <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">
                {shares ? (
                  <>
                    {formatters.share(share)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {formatters.value(entry.value)}
                    </span>
                  </>
                ) : (
                  formatters.value(entry.value)
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export type { ChartFormatters as UsageChartFormatters };
