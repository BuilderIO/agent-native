import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
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
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_COLORS, formatDate } from "../types";
import { MetricValidationButton } from "@/components/MetricValidationButton";

type ChartType = "stacked-area" | "stacked-bar" | "line";

const MAX_SERIES = 10;

interface DynamicChartProps {
  title: string;
  rows: Record<string, unknown>[];
  dateKey?: string;
  seriesKey?: string;
  valueKey: string;
  chartType: ChartType;
  isLoading?: boolean;
  error?: string;
  yFormatter?: (value: number) => string;
  height?: number;
  defaultCollapsed?: boolean;
}

interface PivotedRow {
  date: string;
  [key: string]: string | number;
}

function pivotData(
  rows: Record<string, unknown>[],
  dateKey: string,
  seriesKey: string,
  valueKey: string
): { data: PivotedRow[]; seriesNames: string[] } {
  const seriesTotals = new Map<string, number>();
  const dateMap = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const date = String(row[dateKey] ?? "");
    const series = String(row[seriesKey] ?? "null");
    const value = Number(row[valueKey] ?? 0);

    seriesTotals.set(series, (seriesTotals.get(series) || 0) + Math.abs(value));
    if (!dateMap.has(date)) {
      dateMap.set(date, {});
    }
    const entry = dateMap.get(date)!;
    entry[series] = (entry[series] || 0) + value;
  }

  // Rank series by total value, keep top N, bucket rest as "Other"
  const ranked = Array.from(seriesTotals.entries()).sort((a, b) => b[1] - a[1]);
  const topSeriesSet = new Set(ranked.slice(0, MAX_SERIES).map(([name]) => name));
  const hasOther = ranked.length > MAX_SERIES;

  const seriesNames = ranked.slice(0, MAX_SERIES).map(([name]) => name);
  if (hasOther) seriesNames.push("Other");

  const data: PivotedRow[] = [];
  const sortedDates = Array.from(dateMap.keys()).sort();

  for (const date of sortedDates) {
    const entry = dateMap.get(date)!;
    const row: PivotedRow = { date };
    let otherSum = 0;

    for (const [series, val] of Object.entries(entry)) {
      if (topSeriesSet.has(series)) {
        row[series] = val;
      } else {
        otherSum += val;
      }
    }

    for (const s of seriesNames) {
      if (s === "Other") {
        row[s] = otherSum;
      } else if (!(s in row)) {
        row[s] = 0;
      }
    }

    data.push(row);
  }

  return { data, seriesNames };
}

export function DynamicChart({
  title,
  rows,
  dateKey = "flex_date",
  seriesKey = "flex_view_by",
  valueKey,
  chartType,
  isLoading,
  error,
  yFormatter,
  height = 300,
  defaultCollapsed = false,
}: DynamicChartProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const { data, seriesNames } = useMemo(
    () => pivotData(rows, dateKey, seriesKey, valueKey),
    [rows, dateKey, seriesKey, valueKey]
  );

  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const toggleSeries = (name: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const visibleSeries = seriesNames.filter((s) => !hiddenSeries.has(s));

  const compactFormatter = (val: number) => {
    if (yFormatter) return yFormatter(val);
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
    return String(val);
  };

  const getColor = (name: string) => {
    if (name === "Other") return "#64748b";
    const idx = seriesNames.indexOf(name);
    return CHART_COLORS[idx % CHART_COLORS.length];
  };

  // Calculate total value for validation
  const totalValue = useMemo(() => {
    return data.reduce((sum, row) => {
      const rowSum = visibleSeries.reduce((s, series) => s + (Number(row[series]) || 0), 0);
      return sum + rowSum;
    }, 0);
  }, [data, visibleSeries]);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className={`${collapsed ? "py-3" : "pb-2"} flex flex-row items-center justify-between space-y-0`}>
        <div
          className="flex items-center gap-1.5 flex-1 cursor-pointer select-none"
          onClick={() => setCollapsed((c) => !c)}
        >
          <ChevronRight
            className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
          <CardTitle className="text-sm font-medium leading-normal">
            {title}
          </CardTitle>
        </div>
        {!collapsed && !isLoading && (
          <MetricValidationButton
            metricName={title}
            metricValue={totalValue}
            variant="ghost"
            size="icon"
          />
        )}
      </CardHeader>
      {!collapsed && (
        <CardContent>
          {isLoading ? (
            <Skeleton className="w-full" style={{ height }} />
          ) : error ? (
            <p className="text-sm text-red-400 py-8 text-center">{error}</p>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No data available
            </p>
          ) : (
            <>
              <div style={{ height }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === "stacked-area" ? (
                    <AreaChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis dataKey="date" stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatDate} />
                      <YAxis stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compactFormatter} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={formatDate} />
                      {visibleSeries.map((name) => (
                        <Area key={name} type="monotone" dataKey={name} stackId="1" stroke={getColor(name)} fill={getColor(name)} fillOpacity={0.6} />
                      ))}
                    </AreaChart>
                  ) : chartType === "stacked-bar" ? (
                    <BarChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis dataKey="date" stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatDate} />
                      <YAxis stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compactFormatter} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={formatDate} />
                      {visibleSeries.map((name) => (
                        <Bar key={name} dataKey={name} stackId="1" fill={getColor(name)} />
                      ))}
                    </BarChart>
                  ) : (
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis dataKey="date" stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatDate} />
                      <YAxis stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compactFormatter} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={formatDate} />
                      {visibleSeries.map((name) => (
                        <Line key={name} type="monotone" dataKey={name} stroke={getColor(name)} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
              <CompactLegend
                seriesNames={seriesNames}
                hiddenSeries={hiddenSeries}
                onToggle={toggleSeries}
                getColor={getColor}
              />
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

const tooltipStyle = {
  backgroundColor: "#09090b",
  border: "1px solid #27272a",
  borderRadius: "8px",
  color: "#fafafa",
  fontSize: "12px",
};

function CompactLegend({
  seriesNames,
  hiddenSeries,
  onToggle,
  getColor,
}: {
  seriesNames: string[];
  hiddenSeries: Set<string>;
  onToggle: (name: string) => void;
  getColor: (name: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-2 max-h-[60px] overflow-y-auto">
      {seriesNames.map((name) => {
        const isHidden = hiddenSeries.has(name);
        return (
          <button
            key={name}
            onClick={() => onToggle(name)}
            className="flex items-center gap-1 text-[10px] leading-tight py-0.5 hover:opacity-80 transition-opacity"
            style={{ opacity: isHidden ? 0.3 : 1 }}
          >
            <span
              className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: getColor(name) }}
            />
            <span className="text-muted-foreground truncate max-w-[100px]">
              {name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
