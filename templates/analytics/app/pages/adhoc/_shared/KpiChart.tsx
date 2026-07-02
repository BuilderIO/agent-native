import { useT } from "@agent-native/core/client";
import { IconCode } from "@tabler/icons-react";
import { useMemo } from "react";
import {
  AreaChart,
  BarChart,
  LineChart,
  Area,
  Bar,
  Line,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  chartAxisStroke,
  chartGridStroke,
  chartTooltipContentStyle,
  chartTooltipCursorFill,
  chartTooltipCursorStroke,
} from "@/lib/chart-theme";

import { formatDate } from "./format";

interface KpiChartProps {
  title: string;
  subtitle?: string;
  rows: Record<string, unknown>[];
  dataKey: string;
  chartType?: "area" | "bar" | "line";
  color?: string;
  isLoading: boolean;
  error?: string;
  yFormatter?: (val: number) => string;
  latestValue?: string;
  referenceLine?: { y: number; label: string; color: string };
  onEditSql?: () => void;
}

export function KpiChart({
  title,
  subtitle,
  rows,
  dataKey,
  chartType = "area",
  color = "var(--brand-blue)",
  isLoading,
  error,
  yFormatter,
  latestValue,
  referenceLine,
  onEditSql,
}: KpiChartProps) {
  const t = useT();
  const data = useMemo(() => {
    return rows.map((r) => ({
      period: String(r.period ?? ""),
      [dataKey]: Number(r[dataKey] ?? 0),
    }));
  }, [rows, dataKey]);

  const formatY =
    yFormatter ??
    ((v: number) => {
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
      if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
      return String(v);
    });

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {latestValue && (
              <span className="text-xl font-bold tabular-nums">
                {latestValue}
              </span>
            )}
            {onEditSql && (
              <ShadcnTooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onEditSql}
                    className="h-7 w-7 p-0"
                  >
                    <IconCode className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.editSqlQuery")}</TooltipContent>
              </ShadcnTooltip>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-400 py-4 text-center">{error}</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t("common.noData")}
          </p>
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "bar" ? (
                <BarChart data={data}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={chartGridStroke}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="period"
                    stroke={chartAxisStroke}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatDate}
                  />
                  <YAxis
                    stroke={chartAxisStroke}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatY}
                  />
                  <Tooltip
                    cursor={{ fill: chartTooltipCursorFill }}
                    contentStyle={{
                      ...chartTooltipContentStyle,
                      fontSize: "12px",
                    }}
                    labelFormatter={formatDate}
                    formatter={(v: any) => [formatY(Number(v)), title]}
                  />
                  <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} />
                  {referenceLine && (
                    <ReferenceLine
                      y={referenceLine.y}
                      stroke={referenceLine.color}
                      strokeDasharray="6 3"
                      strokeOpacity={0.7}
                      label={{
                        value: referenceLine.label,
                        fill: referenceLine.color,
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                  )}
                </BarChart>
              ) : chartType === "line" ? (
                <LineChart data={data}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={chartGridStroke}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="period"
                    stroke={chartAxisStroke}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatDate}
                  />
                  <YAxis
                    stroke={chartAxisStroke}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatY}
                  />
                  <Tooltip
                    cursor={{ stroke: chartTooltipCursorStroke }}
                    contentStyle={{
                      ...chartTooltipContentStyle,
                      fontSize: "12px",
                    }}
                    labelFormatter={formatDate}
                    formatter={(v: any) => [formatY(Number(v)), title]}
                  />
                  <Line
                    type="monotone"
                    dataKey={dataKey}
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                  />
                  {referenceLine && (
                    <ReferenceLine
                      y={referenceLine.y}
                      stroke={referenceLine.color}
                      strokeDasharray="6 3"
                      strokeOpacity={0.7}
                      label={{
                        value: referenceLine.label,
                        fill: referenceLine.color,
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                  )}
                </LineChart>
              ) : (
                <AreaChart data={data}>
                  <defs>
                    <linearGradient
                      id={`grad-${dataKey}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={chartGridStroke}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="period"
                    stroke={chartAxisStroke}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatDate}
                  />
                  <YAxis
                    stroke={chartAxisStroke}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatY}
                  />
                  <Tooltip
                    cursor={{ stroke: chartTooltipCursorStroke }}
                    contentStyle={{
                      ...chartTooltipContentStyle,
                      fontSize: "12px",
                    }}
                    labelFormatter={formatDate}
                    formatter={(v: any) => [formatY(Number(v)), title]}
                  />
                  <Area
                    type="monotone"
                    dataKey={dataKey}
                    stroke={color}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill={`url(#grad-${dataKey})`}
                  />
                  {referenceLine && (
                    <ReferenceLine
                      y={referenceLine.y}
                      stroke={referenceLine.color}
                      strokeDasharray="6 3"
                      strokeOpacity={0.7}
                      label={{
                        value: referenceLine.label,
                        fill: referenceLine.color,
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                  )}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
