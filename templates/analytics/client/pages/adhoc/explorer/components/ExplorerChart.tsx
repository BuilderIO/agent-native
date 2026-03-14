import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExplorerConfig } from "../types";
import type { QueryMetricsResult } from "@/lib/query-metrics";

const COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#06b6d4",
  "#84cc16",
];

interface ExplorerChartProps {
  config: ExplorerConfig;
  result: QueryMetricsResult | undefined;
  isLoading: boolean;
  sql: string;
}

export function ExplorerChart({
  config,
  result,
  isLoading,
  sql,
}: ExplorerChartProps) {
  const rows = result?.rows ?? [];
  const error = result?.error;

  if (!sql) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          Add an event and select it to see results
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-destructive text-sm">Query error: {error}</div>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          No data returned
        </CardContent>
      </Card>
    );
  }

  switch (config.chartType) {
    case "metric":
      return <MetricView rows={rows} config={config} />;
    case "table":
      return <TableView rows={rows} />;
    case "line":
    case "bar":
      return <TimeSeriesView rows={rows} config={config} />;
  }
}

function MetricView({
  rows,
  config,
}: {
  rows: Record<string, unknown>[];
  config: ExplorerConfig;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {rows.map((row, i) => {
        const label = String(
          row.event_label ?? config.events[0]?.event ?? "Count",
        );
        const value = Number(row.count ?? 0);
        return (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value.toLocaleString()}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TableView({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  const columns = Object.keys(rows[0]);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="text-left px-3 py-2 font-medium text-muted-foreground"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-1.5">
                      {formatCell(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function TimeSeriesView({
  rows,
  config,
}: {
  rows: Record<string, unknown>[];
  config: ExplorerConfig;
}) {
  const hasGroupBy = config.events.some((e) => e.groupBy.length > 0);
  const hasMultiEvents = config.events.length > 1;
  const seriesKey = hasMultiEvents
    ? "event_label"
    : hasGroupBy
      ? config.events[0]?.groupBy[0]
      : null;

  const { chartData, seriesNames } = useMemo(() => {
    if (!seriesKey) {
      // Simple: date + count
      return {
        chartData: rows.map((r) => ({
          date: formatDate(r.date),
          count: Number(r.count ?? 0),
        })),
        seriesNames: ["count"],
      };
    }

    // Pivot: date x series → wide format
    const dateMap = new Map<string, Record<string, number>>();
    const allSeries = new Set<string>();

    for (const row of rows) {
      const d = formatDate(row.date);
      const s = String(row[seriesKey] ?? "unknown");
      const v = Number(row.count ?? 0);
      allSeries.add(s);
      if (!dateMap.has(d)) dateMap.set(d, {});
      const entry = dateMap.get(d)!;
      entry[s] = (entry[s] ?? 0) + v;
    }

    // Rank series by total, keep top 10
    const totals = new Map<string, number>();
    for (const entry of dateMap.values()) {
      for (const [s, v] of Object.entries(entry)) {
        totals.set(s, (totals.get(s) ?? 0) + v);
      }
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const topSeries = ranked.slice(0, 10).map(([s]) => s);
    const hasOther = ranked.length > 10;

    const chartData = [...dateMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entry]) => {
        const point: Record<string, unknown> = { date };
        for (const s of topSeries) {
          point[s] = entry[s] ?? 0;
        }
        if (hasOther) {
          let otherVal = 0;
          for (const [s, v] of Object.entries(entry)) {
            if (!topSeries.includes(s)) otherVal += v;
          }
          point["Other"] = otherVal;
        }
        return point;
      });

    const names = hasOther ? [...topSeries, "Other"] : topSeries;
    return { chartData, seriesNames: names };
  }, [rows, seriesKey]);

  const ChartComponent = config.chartType === "bar" ? BarChart : LineChart;

  return (
    <Card>
      <CardContent className="p-4">
        <ResponsiveContainer width="100%" height={350}>
          <ChartComponent data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              className="text-muted-foreground"
            />
            <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            {seriesNames.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 11 }} />
            )}
            {seriesNames.map((name, i) =>
              config.chartType === "bar" ? (
                <Bar
                  key={name}
                  dataKey={name}
                  fill={COLORS[i % COLORS.length]}
                  stackId={seriesNames.length > 1 ? "stack" : undefined}
                />
              ) : (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ),
            )}
          </ChartComponent>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function formatDate(val: unknown): string {
  if (!val) return "";
  const s = String(val);
  // BigQuery DATE format: { value: "2024-01-15" } or plain string
  if (typeof val === "object" && val !== null && "value" in val) {
    return String((val as any).value);
  }
  return s.slice(0, 10);
}

function formatCell(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "number") return val.toLocaleString();
  if (typeof val === "object" && val !== null && "value" in val)
    return String((val as any).value);
  return String(val);
}
