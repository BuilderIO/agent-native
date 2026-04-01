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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { IconCode } from "@tabler/icons-react";
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
  color = "#6366f1",
  isLoading,
  error,
  yFormatter,
  latestValue,
  referenceLine,
  onEditSql,
}: KpiChartProps) {
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
              <Button
                variant="ghost"
                size="sm"
                onClick={onEditSql}
                className="h-7 w-7 p-0"
                title="Edit SQL Query"
              >
                <IconCode className="h-3.5 w-3.5" />
              </Button>
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
            No data
          </p>
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "bar" ? (
                <BarChart data={data}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#27272a"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="period"
                    stroke="#52525b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatDate}
                  />
                  <YAxis
                    stroke="#52525b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatY}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.06)" }}
                    contentStyle={{
                      backgroundColor: "#09090b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      color: "#fafafa",
                      fontSize: "12px",
                    }}
                    labelFormatter={formatDate}
                    formatter={(v: number) => [formatY(v), title]}
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
                    stroke="#27272a"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="period"
                    stroke="#52525b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatDate}
                  />
                  <YAxis
                    stroke="#52525b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatY}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(255,255,255,0.15)" }}
                    contentStyle={{
                      backgroundColor: "#09090b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      color: "#fafafa",
                      fontSize: "12px",
                    }}
                    labelFormatter={formatDate}
                    formatter={(v: number) => [formatY(v), title]}
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
                    stroke="#27272a"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="period"
                    stroke="#52525b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatDate}
                  />
                  <YAxis
                    stroke="#52525b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatY}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(255,255,255,0.15)" }}
                    contentStyle={{
                      backgroundColor: "#09090b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      color: "#fafafa",
                      fontSize: "12px",
                    }}
                    labelFormatter={formatDate}
                    formatter={(v: number) => [formatY(v), title]}
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
