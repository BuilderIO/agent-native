import { useState, useMemo, useCallback } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import {
  type DateRange,
  issuesBySeverityPerDaySql,
  issuesByRepoByDaySql,
  formatDate,
  CHART_AXIS_STYLE,
  TOOLTIP_STYLE,
  GRID_STYLE,
} from "./queries";
import { ChartPopover, type PopoverState } from "./ChartPopover";
import { ChartTitleWithInfo } from "./ChartTitle";

const SEVERITY_COLORS = {
  high: "#ef4444",
  medium: "#f59e0b",
};

interface Props {
  dateRange: DateRange;
}

export function IssuesBySeverityChart({ dateRange }: Props) {
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const series = useMetricsQuery(
    ["pr-review-issues-severity", dateRange],
    issuesBySeverityPerDaySql(dateRange)
  );

  const repoBreakdown = useMetricsQuery(
    ["pr-review-issues-by-repo-day", dateRange],
    issuesByRepoByDaySql(dateRange)
  );

  const chartData = useMemo(
    () =>
      (series.data?.rows ?? []).map((r) => ({
        day: r.day as string,
        high: Number(r.high || 0),
        medium: Number(r.medium || 0),
      })),
    [series.data]
  );

  const breakdownByDay = useMemo(() => {
    const map = new Map<string, { label: string; value: number }[]>();
    for (const r of repoBreakdown.data?.rows ?? []) {
      const day = r.day as string;
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push({
        label: String(r.repo_full_name),
        value: Number(r.issues_posted || 0),
      });
    }
    return map;
  }, [repoBreakdown.data]);

  const handleClick = useCallback(
    (data: Record<string, unknown>, _index: number, e: React.MouseEvent) => {
      const day = data.day as string;
      const rows = breakdownByDay.get(day) ?? [];
      setPopover({ x: e.clientX, y: e.clientY, day, rows });
    },
    [breakdownByDay]
  );

  const closePopover = useCallback(() => setPopover(null), []);

  return (
    <Card className="bg-card border-border/50 relative">
      <CardHeader className="pb-2">
        <ChartTitleWithInfo
          title="Issues Found per Day by Severity"
          description="Code issues identified by the bot, split by severity (high vs medium). Click a bar to see the breakdown by repository."
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
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                <Bar
                  dataKey="high"
                  name="High"
                  stackId="severity"
                  fill={SEVERITY_COLORS.high}
                  cursor="pointer"
                  onClick={handleClick}
                />
                <Bar
                  dataKey="medium"
                  name="Medium"
                  stackId="severity"
                  fill={SEVERITY_COLORS.medium}
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={handleClick}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
      <ChartPopover state={popover} onClose={closePopover} valueLabel="Issues" />
    </Card>
  );
}
