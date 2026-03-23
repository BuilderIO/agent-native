import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import {
  type DateRange,
  postedVsResolvedPerDaySql,
  formatDate,
  CHART_AXIS_STYLE,
  TOOLTIP_STYLE,
  GRID_STYLE,
} from "./queries";
import { ChartTitleWithInfo } from "./ChartTitle";

interface Props {
  dateRange: DateRange;
}

export function PostedVsResolvedChart({ dateRange }: Props) {
  const series = useMetricsQuery(
    ["pr-review-posted-vs-resolved-v2", dateRange],
    postedVsResolvedPerDaySql(dateRange),
  );

  const chartData = useMemo(
    () =>
      (series.data?.rows ?? []).map((r) => ({
        day: r.day as string,
        issues_posted: Number(r.issues_posted || 0),
        issues_resolved: Number(r.issues_resolved || 0),
        issues_dropped: Number(r.issues_dropped || 0),
      })),
    [series.data],
  );

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <ChartTitleWithInfo
          title="Issues Posted vs Resolved per Day"
          description="Compares issues posted by the bot vs issues resolved by developers. The dashed line shows issues that were dropped (dismissed without resolution)."
        />
      </CardHeader>
      <CardContent>
        {series.isLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No data available
          </p>
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="posted-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient
                    id="resolved-grad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  {...CHART_AXIS_STYLE}
                  tickFormatter={formatDate}
                />
                <YAxis {...CHART_AXIS_STYLE} allowDecimals={false} />
                <CartesianGrid {...GRID_STYLE} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={formatDate}
                />
                <Legend
                  wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                />
                <Area
                  type="monotone"
                  dataKey="issues_posted"
                  name="Issues Posted"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#posted-grad)"
                />
                <Area
                  type="monotone"
                  dataKey="issues_resolved"
                  name="Issues Resolved"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#resolved-grad)"
                />
                <Line
                  type="monotone"
                  dataKey="issues_dropped"
                  name="Issues Dropped"
                  stroke="#6b7280"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
