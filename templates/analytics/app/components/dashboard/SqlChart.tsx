import { useMemo } from "react";
import { Link } from "react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IconExternalLink } from "@tabler/icons-react";
import { useSqlQuery } from "@/lib/sql-query";
import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

const DEFAULT_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
];

function formatYValue(
  value: number,
  formatter?: "number" | "currency" | "percent",
): string {
  if (formatter === "currency") return `$${value.toLocaleString()}`;
  if (formatter === "percent") return `${value}%`;
  return value.toLocaleString();
}

function formatXLabel(value: string): string {
  try {
    const d = new Date(value);
    if (!isNaN(d.getTime()) && value.length >= 8) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  } catch {}
  return String(value);
}

function detectKeys(
  rows: Record<string, unknown>[],
  config?: SqlPanel["config"],
): { xKey: string; yKeys: string[] } {
  if (config?.xKey && (config?.yKey || config?.yKeys?.length)) {
    return {
      xKey: config.xKey,
      yKeys: config.yKeys ?? (config.yKey ? [config.yKey] : []),
    };
  }

  if (rows.length === 0) return { xKey: "", yKeys: [] };

  const cols = Object.keys(rows[0]);
  const sample = rows[0] as Record<string, unknown>;

  // Find the x-axis: prefer a date-like or string column
  let xKey = config?.xKey || "";
  if (!xKey) {
    xKey =
      cols.find((c) => {
        const v = sample[c];
        if (typeof v === "string" && v.length >= 8) {
          const d = new Date(v);
          return !isNaN(d.getTime());
        }
        return false;
      }) ||
      cols.find((c) => typeof sample[c] === "string") ||
      cols[0];
  }

  // Y keys: all numeric columns that aren't the x-axis
  const yKeys = config?.yKeys ?? (config?.yKey ? [config.yKey] : []);
  if (yKeys.length === 0) {
    for (const c of cols) {
      if (c === xKey) continue;
      if (typeof sample[c] === "number") yKeys.push(c);
    }
  }
  if (yKeys.length === 0 && cols.length > 1) {
    yKeys.push(cols.find((c) => c !== xKey) || cols[1]);
  }

  return { xKey, yKeys };
}

interface SqlChartProps {
  panel: SqlPanel;
  className?: string;
}

export function SqlChart({ panel }: SqlChartProps) {
  const { data: result, isLoading } = useSqlQuery(
    ["sql-chart", panel.id, panel.sql, panel.source],
    panel.sql,
    panel.source,
  );

  const rows = result?.rows ?? [];
  const error = result?.error;
  const { xKey, yKeys } = useMemo(
    () => detectKeys(rows, panel.config),
    [rows, panel.config],
  );
  const color = panel.config?.color || DEFAULT_COLORS[0];
  const colors = panel.config?.colors || DEFAULT_COLORS;
  const yFormatter = panel.config?.yFormatter;

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  if (error) {
    return (
      <p className="text-sm text-red-400 py-8 text-center break-all px-4">
        {error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
    );
  }

  if (panel.chartType === "metric") {
    return <MetricRenderer rows={rows} panel={panel} />;
  }

  if (panel.chartType === "table") {
    return <TableRenderer rows={rows} />;
  }

  if (panel.chartType === "pie") {
    return (
      <PieRenderer rows={rows} xKey={xKey} yKey={yKeys[0]} colors={colors} />
    );
  }

  if (panel.chartType === "bar") {
    return (
      <BarRenderer
        rows={rows}
        xKey={xKey}
        yKeys={yKeys}
        colors={colors}
        yFormatter={yFormatter}
      />
    );
  }

  // line or area
  return (
    <TimeSeriesRenderer
      rows={rows}
      xKey={xKey}
      yKeys={yKeys}
      colors={colors}
      yFormatter={yFormatter}
      chartType={panel.chartType}
    />
  );
}

function MetricRenderer({
  rows,
  panel,
}: {
  rows: Record<string, unknown>[];
  panel: SqlPanel;
}) {
  const row = rows[0];
  const cols = Object.keys(row);
  const valueCol =
    panel.config?.yKey ||
    cols.find((c) => typeof row[c] === "number") ||
    cols[0];
  const raw = row[valueCol];
  const value =
    typeof raw === "number"
      ? formatYValue(raw, panel.config?.yFormatter)
      : String(raw ?? "-");

  return (
    <div className="flex flex-col items-center justify-center py-6">
      <div className="text-3xl font-bold">{value}</div>
      {panel.config?.description && (
        <p className="text-xs text-muted-foreground mt-1">
          {panel.config.description}
        </p>
      )}
    </div>
  );
}

function TableRenderer({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-auto max-h-[300px]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {cols.map((c) => (
              <th
                key={c}
                className="text-left py-1.5 px-2 font-medium text-muted-foreground whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              {cols.map((c) => (
                <td key={c} className="py-1.5 px-2 whitespace-nowrap">
                  {String(row[c] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PieRenderer({
  rows,
  xKey,
  yKey,
  colors,
}: {
  rows: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  colors: string[];
}) {
  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={rows}
            dataKey={yKey}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={({ name, percent }) =>
              `${name} ${(percent * 100).toFixed(0)}%`
            }
            labelLine={false}
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarRenderer({
  rows,
  xKey,
  yKeys,
  colors,
  yFormatter,
}: {
  rows: Record<string, unknown>[];
  xKey: string;
  yKeys: string[];
  colors: string[];
  yFormatter?: "number" | "currency" | "percent";
}) {
  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <XAxis
            dataKey={xKey}
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatXLabel}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatYValue(v, yFormatter)}
          />
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
            }}
            labelFormatter={formatXLabel}
          />
          {yKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={colors[i % colors.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TimeSeriesRenderer({
  rows,
  xKey,
  yKeys,
  colors,
  yFormatter,
  chartType,
}: {
  rows: Record<string, unknown>[];
  xKey: string;
  yKeys: string[];
  colors: string[];
  yFormatter?: "number" | "currency" | "percent";
  chartType: "line" | "area";
}) {
  if (chartType === "line") {
    return (
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <XAxis
              dataKey={xKey}
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatXLabel}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatYValue(v, yFormatter)}
            />
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
              }}
              labelFormatter={formatXLabel}
            />
            {yKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // area
  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
          <defs>
            {yKeys.map((key, i) => (
              <linearGradient
                key={key}
                id={`sql-gradient-${key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={colors[i % colors.length]}
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor={colors[i % colors.length]}
                  stopOpacity={0}
                />
              </linearGradient>
            ))}
          </defs>
          <XAxis
            dataKey={xKey}
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatXLabel}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatYValue(v, yFormatter)}
          />
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
            }}
            labelFormatter={formatXLabel}
          />
          {yKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#sql-gradient-${key})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SqlChartWithCard({ panel }: { panel: SqlPanel }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium truncate">
          {panel.title}
        </CardTitle>
        {panel.sql && (
          <Link
            to={`/query?sql=${encodeURIComponent(panel.sql)}`}
            className="text-muted-foreground/50 hover:text-foreground p-1 shrink-0"
            title="Open in Query Explorer"
          >
            <IconExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <SqlChart panel={panel} />
      </CardContent>
    </Card>
  );
}
