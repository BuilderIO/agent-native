import { useMemo } from "react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useGCloudMetrics } from "./hooks";
import type { TimePeriod, ServiceType, MetricTimeSeries } from "./types";
import { ShieldAlert } from "lucide-react";

const COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#f97316",
];

function formatTime(ts: string, period: TimePeriod) {
  const d = new Date(ts);
  if (period === "1h" || period === "6h") {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}

function formatValue(val: number, metric: string): string {
  if (metric.includes("latenc") || metric.includes("duration")) {
    if (val >= 1000) return `${(val / 1000).toFixed(1)}s`;
    return `${val.toFixed(0)}ms`;
  }
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
  return val.toFixed(1);
}

function seriesToChartData(
  timeSeries: MetricTimeSeries[],
  period: TimePeriod
): { data: Record<string, unknown>[]; seriesNames: string[] } {
  if (!timeSeries.length) return { data: [], seriesNames: [] };

  const timeMap = new Map<string, Record<string, unknown>>();
  const seriesNames: string[] = [];

  for (const ts of timeSeries) {
    const label =
      ts.labels.service_name ||
      ts.labels.function_name ||
      ts.labels.revision_name ||
      "value";
    if (!seriesNames.includes(label)) seriesNames.push(label);

    for (const point of ts.points) {
      const timeKey = point.timestamp;
      if (!timeMap.has(timeKey)) {
        timeMap.set(timeKey, {
          time: formatTime(timeKey, period),
          _ts: timeKey,
        });
      }
      const row = timeMap.get(timeKey)!;
      row[label] = point.value;
    }
  }

  const data = Array.from(timeMap.values()).sort((a, b) =>
    (a._ts as string).localeCompare(b._ts as string)
  );

  return { data, seriesNames };
}

interface MetricChartProps {
  title: string;
  service: string | undefined;
  metric: string;
  period: TimePeriod;
  type: ServiceType;
  chartType?: "line" | "area";
  extraFilter?: string;
  color?: string;
}

function MetricChart({
  title,
  service,
  metric,
  period,
  type,
  chartType = "line",
  extraFilter,
  color,
}: MetricChartProps) {
  const { data: response, isLoading } = useGCloudMetrics(
    service,
    metric,
    period,
    type,
    extraFilter
  );

  const timeSeries = response?.timeSeries ?? [];
  const permissionWarning = response?.permissionWarning;

  const { data: chartData, seriesNames } = useMemo(
    () => seriesToChartData(timeSeries, period),
    [timeSeries, period]
  );

  if (!service) {
    return <EmptyChart title={title} message="Select a service" />;
  }

  if (isLoading) {
    return <ChartSkeleton title={title} />;
  }

  if (permissionWarning) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-card-foreground mb-3">
          {title}
        </h3>
        <div className="h-[280px] flex flex-col items-center justify-center gap-3">
          <ShieldAlert className="h-8 w-8 text-amber-400" />
          <div className="text-xs text-amber-300 text-center max-w-[280px]">
            Monitoring API access denied. Grant{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-[10px]">
              monitoring.viewer
            </code>{" "}
            role to the service account.
          </div>
        </div>
      </div>
    );
  }

  if (!chartData.length) {
    return <EmptyChart title={title} />;
  }

  const ChartComponent = chartType === "area" ? AreaChart : LineChart;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-card-foreground mb-3">
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <ChartComponent data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
            height={30}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v) => formatValue(v, metric)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number) => [formatValue(value, metric), ""]}
          />
          {seriesNames.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 11 }} />
          )}
          {seriesNames.map((name, i) => {
            const strokeColor = color || COLORS[i % COLORS.length];
            return chartType === "area" ? (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                stroke={strokeColor}
                fill={strokeColor}
                fillOpacity={0.15}
                strokeWidth={2}
                dot={false}
              />
            ) : (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={strokeColor}
                strokeWidth={2}
                dot={false}
              />
            );
          })}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}

interface MetricsChartsProps {
  service: string | undefined;
  period: TimePeriod;
  type: ServiceType;
}

export function MetricsCharts({ service, period, type }: MetricsChartsProps) {
  if (type === "cloud_function") {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricChart
          title="Execution Count"
          service={service}
          metric="cloudfunctions.googleapis.com/function/execution_count"
          period={period}
          type={type}
        />
        <MetricChart
          title="Execution Time"
          service={service}
          metric="cloudfunctions.googleapis.com/function/execution_times"
          period={period}
          type={type}
        />
        <MetricChart
          title="Errors"
          service={service}
          metric="cloudfunctions.googleapis.com/function/execution_count"
          period={period}
          type={type}
          extraFilter='metric.labels.status="error"'
          color="#ef4444"
        />
        <MetricChart
          title="Active Instances"
          service={service}
          metric="cloudfunctions.googleapis.com/function/active_instances"
          period={period}
          type={type}
          chartType="area"
        />
        <MetricChart
          title="Memory Usage"
          service={service}
          metric="cloudfunctions.googleapis.com/function/user_memory_bytes"
          period={period}
          type={type}
          chartType="area"
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <MetricChart
        title="Request Count"
        service={service}
        metric="run.googleapis.com/request_count"
        period={period}
        type={type}
      />
      <MetricChart
        title="Request Latency (p99)"
        service={service}
        metric="run.googleapis.com/request_latencies"
        period={period}
        type={type}
      />
      <MetricChart
        title="5xx Errors"
        service={service}
        metric="run.googleapis.com/request_count"
        period={period}
        type={type}
        extraFilter='metric.labels.response_code_class="5xx"'
        color="#ef4444"
      />
      <MetricChart
        title="4xx Client Errors"
        service={service}
        metric="run.googleapis.com/request_count"
        period={period}
        type={type}
        extraFilter='metric.labels.response_code_class="4xx"'
        color="#f59e0b"
      />
      <MetricChart
        title="Container Instance Count"
        service={service}
        metric="run.googleapis.com/container/instance_count"
        period={period}
        type={type}
        chartType="area"
      />
      <MetricChart
        title="CPU Utilization"
        service={service}
        metric="run.googleapis.com/container/cpu/utilizations"
        period={period}
        type={type}
        chartType="area"
      />
    </div>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-card-foreground mb-3">
        {title}
      </h3>
      <div className="h-[280px] flex flex-col gap-3 pt-4">
        <div className="h-4 w-24 rounded bg-muted animate-pulse" />
        <div className="flex-1 rounded bg-muted/50 animate-pulse" />
      </div>
    </div>
  );
}

function EmptyChart({
  title,
  message = "No data available",
}: {
  title: string;
  message?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-card-foreground mb-3">
        {title}
      </h3>
      <div className="h-[280px] flex items-center justify-center">
        <div className="text-sm text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}
