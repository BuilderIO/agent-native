import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  IconArrowsSort,
  IconSortAscending,
  IconSortDescending,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
import { useSqlQuery } from "@/lib/sql-query";
import type {
  SqlPanel,
  ChartType,
  TableColumnConfig,
  ColumnFormat,
} from "@/pages/adhoc/sql-dashboard/types";
import { pivotRows } from "@/pages/adhoc/sql-dashboard/pivot";

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
  if (formatter === "percent") {
    // SQL typically returns rate as 0..1
    const pct = value <= 1 && value >= -1 ? value * 100 : value;
    return `${pct.toFixed(2)}%`;
  }
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
  forcedYKeys?: string[],
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

  // Pivoted data: caller already knows the series keys
  if (forcedYKeys && forcedYKeys.length) {
    return { xKey, yKeys: forcedYKeys };
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
  /** SQL with dashboard variables already interpolated. Falls back to panel.sql. */
  resolvedSql?: string;
  className?: string;
}

export function SqlChart({ panel, resolvedSql }: SqlChartProps) {
  const sql = resolvedSql ?? panel.sql;
  const { data: result, isLoading } = useSqlQuery(
    ["sql-chart", panel.id, sql, panel.source],
    sql,
    panel.source,
  );

  const rawRows = result?.rows ?? [];
  const error = result?.error;

  const { rows, forcedYKeys } = useMemo(() => {
    if (panel.config?.pivot && rawRows.length) {
      const pivoted = pivotRows(rawRows, panel.config.pivot);
      return { rows: pivoted.rows, forcedYKeys: pivoted.seriesKeys };
    }
    return { rows: rawRows, forcedYKeys: undefined };
  }, [rawRows, panel.config?.pivot]);

  const { xKey, yKeys } = useMemo(
    () => detectKeys(rows, panel.config, forcedYKeys),
    [rows, panel.config, forcedYKeys],
  );
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

  // Legacy normalization: older saved dashboards may still have stacked-*
  // chart types. Render them unstacked rather than silently blank.
  const chartType: ChartType =
    (panel.chartType as string) === "stacked-bar"
      ? "bar"
      : (panel.chartType as string) === "stacked-area"
        ? "area"
        : panel.chartType;

  if (chartType === "metric") {
    return <MetricRenderer rows={rows} panel={panel} />;
  }

  if (chartType === "table") {
    return <TableRenderer rows={rows} panel={panel} />;
  }

  if (chartType === "pie") {
    return (
      <PieRenderer rows={rows} xKey={xKey} yKey={yKeys[0]} colors={colors} />
    );
  }

  if (chartType === "bar") {
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

  return (
    <TimeSeriesRenderer
      rows={rows}
      xKey={xKey}
      yKeys={yKeys}
      colors={colors}
      yFormatter={yFormatter}
      chartType={chartType}
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

function formatCell(value: unknown, format: ColumnFormat | undefined): string {
  if (value == null) return "";
  if (format === "number" && typeof value === "number") {
    return value.toLocaleString();
  }
  if (format === "currency" && typeof value === "number") {
    return `$${value.toLocaleString()}`;
  }
  if (format === "percent" && typeof value === "number") {
    const pct = value <= 1 && value >= -1 ? value * 100 : value;
    return `${pct.toFixed(2)}%`;
  }
  if (format === "date") {
    const d = new Date(String(value));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  return String(value);
}

function TableRenderer({
  rows,
  panel,
}: {
  rows: Record<string, unknown>[];
  panel: SqlPanel;
}) {
  const config = panel.config;
  const sortable = config?.sortable !== false; // default on

  // Resolve column list: explicit config wins, otherwise infer from first row
  const columns = useMemo<TableColumnConfig[]>(() => {
    if (config?.columns?.length) {
      return config.columns.filter((c) => !c.hidden);
    }
    return Object.keys(rows[0]).map((key) => ({ key }));
  }, [config?.columns, rows]);

  // Cap the dataset at `config.limit` before sorting/paginating. Saved
  // dashboards rely on this to keep long-tailed queries snappy — sorting
  // 50k rows client-side to page through the first 50 wastes a lot of work.
  const limitedRows = useMemo(() => {
    const limit = config?.limit;
    return limit != null && rows.length > limit ? rows.slice(0, limit) : rows;
  }, [rows, config?.limit]);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const sortedRows = useMemo(() => {
    if (!sortable || !sortKey) return limitedRows;
    const sorted = [...limitedRows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return av - bv;
      }
      return String(av).localeCompare(String(bv));
    });
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [limitedRows, sortKey, sortDir, sortable]);

  const pageCount = Math.ceil(sortedRows.length / pageSize);
  const displayRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);

  const handleHeaderClick = (key: string) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => {
                const label = col.label ?? col.key;
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={`text-left py-1.5 px-2 font-medium text-muted-foreground whitespace-nowrap ${
                      sortable
                        ? "cursor-pointer select-none hover:text-foreground"
                        : ""
                    }`}
                    onClick={() => handleHeaderClick(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortable &&
                        (isSorted ? (
                          sortDir === "asc" ? (
                            <IconSortAscending className="h-3 w-3" />
                          ) : (
                            <IconSortDescending className="h-3 w-3" />
                          )
                        ) : (
                          <IconArrowsSort className="h-3 w-3 opacity-30" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i} className="border-b border-border/50">
                {columns.map((col) => {
                  const raw = row[col.key];
                  const formatted = formatCell(raw, col.format);
                  if (col.format === "link") {
                    const href = col.linkKey
                      ? String(row[col.linkKey] ?? "")
                      : String(raw ?? "");
                    return (
                      <td
                        key={col.key}
                        className="py-1.5 px-2 whitespace-nowrap"
                      >
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {formatted}
                        </a>
                      </td>
                    );
                  }
                  const numeric =
                    col.format === "number" ||
                    col.format === "currency" ||
                    col.format === "percent";
                  return (
                    <td
                      key={col.key}
                      className={`py-1.5 px-2 whitespace-nowrap ${
                        numeric ? "text-right tabular-nums" : ""
                      }`}
                    >
                      {formatted}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sortedRows.length > PAGE_SIZE_OPTIONS[0] && (
        <div className="flex items-center justify-between px-1 pt-1 border-t border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-6 w-16 px-2 py-0 text-xs border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <span>
              {page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, sortedRows.length)} of{" "}
              {sortedRows.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
            >
              <IconChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= pageCount - 1}
            >
              <IconChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
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
            formatter={(v: number) => formatYValue(v, yFormatter)}
            itemSorter={(item) => -(Number(item.value) || 0)}
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
              formatter={(v: number) => formatYValue(v, yFormatter)}
              itemSorter={(item) => -(Number(item.value) || 0)}
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

  // With multiple series, filled areas stack and obscure lines behind them,
  // so only draw the gradient fill when there's a single series.
  const showFill = yKeys.length === 1;

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
          {showFill && (
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
          )}
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
            formatter={(v: number) => formatYValue(v, yFormatter)}
            itemSorter={(item) => -(Number(item.value) || 0)}
          />
          {yKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              fillOpacity={showFill ? 1 : 0}
              fill={showFill ? `url(#sql-gradient-${key})` : "none"}
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
      </CardHeader>
      <CardContent className="pt-0">
        <SqlChart panel={panel} />
      </CardContent>
    </Card>
  );
}
