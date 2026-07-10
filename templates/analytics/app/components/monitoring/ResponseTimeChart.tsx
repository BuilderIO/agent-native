/**
 * Response-time (latency) chart over a window: an avg area with optional
 * min/max band lines, rendered with the app's charting library (recharts) and
 * themed with the shared chart tokens. Takes a pre-built response-time series.
 *
 * Reusable by the authenticated monitor detail view and the public status page.
 */
import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  chartAxisStroke,
  chartGridStroke,
  chartTooltipContentStyle,
  chartTooltipCursorStroke,
} from "@/lib/chart-theme";
import { cn } from "@/lib/utils";

import { formatBucketTime, formatLatencyMs } from "./chart-utils";
import type { ResponseTimePoint } from "./types";

export interface ResponseTimeChartProps {
  series: ResponseTimePoint[];
  /** Also draw min & max lines around the avg area. Default false. */
  showMinMax?: boolean;
  /** Tailwind height for the chart. Default `h-[200px]`. */
  heightClassName?: string;
  className?: string;
  /** Message shown when the series is empty. */
  emptyText?: string;
}

interface ChartRow {
  label: string;
  avg: number | null;
  min: number | null;
  max: number | null;
}

export function ResponseTimeChart({
  series,
  showMinMax = false,
  heightClassName = "h-[200px]",
  className,
  emptyText = "No response-time data yet",
}: ResponseTimeChartProps) {
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const rows = useMemo<ChartRow[]>(
    () =>
      series.map((point) => ({
        label: formatBucketTime(point.bucketStart),
        avg: point.avg,
        min: point.min,
        max: point.max,
      })),
    [series],
  );

  const hasData = rows.some((row) => row.avg != null);

  if (!hasData) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-border/60 text-sm text-muted-foreground",
          heightClassName,
          className,
        )}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div className={cn("w-full", heightClassName, className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--brand-blue)"
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor="var(--brand-blue)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={chartGridStroke}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke={chartAxisStroke}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            hide
          />
          <YAxis
            stroke={chartAxisStroke}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => `${Math.round(v)}ms`}
          />
          <Tooltip
            cursor={{ stroke: chartTooltipCursorStroke }}
            contentStyle={{ ...chartTooltipContentStyle, fontSize: "12px" }}
            formatter={(value: any, name: any) => [
              formatLatencyMs(typeof value === "number" ? value : null),
              name,
            ]}
          />
          {showMinMax ? (
            <Line
              type="monotone"
              dataKey="max"
              name="Max"
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeOpacity={0.4}
              strokeDasharray="2 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
          <Area
            type="monotone"
            dataKey="avg"
            name="Avg"
            stroke="var(--brand-blue)"
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#${gradientId})`}
            connectNulls
            isAnimationActive={false}
          />
          {showMinMax ? (
            <Line
              type="monotone"
              dataKey="min"
              name="Min"
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeOpacity={0.4}
              strokeDasharray="2 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
