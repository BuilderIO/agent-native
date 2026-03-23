import { useState, useMemo, useCallback } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
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
  reposPerDaySql,
  repoBreakdownByDaySql,
  formatDate,
  CHART_AXIS_STYLE,
  TOOLTIP_STYLE,
  GRID_STYLE,
} from "./queries";
import { ChartPopover, type PopoverState } from "./ChartPopover";
import { ChartTitleWithInfo } from "./ChartTitle";

interface Props {
  dateRange: DateRange;
}

export function ReposPerDayChart({ dateRange }: Props) {
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const series = useMetricsQuery(
    ["pr-review-repos-per-day", dateRange],
    reposPerDaySql(dateRange),
  );

  const breakdown = useMetricsQuery(
    ["pr-review-repo-breakdown-by-day", dateRange],
    repoBreakdownByDaySql(dateRange),
  );

  const chartData = useMemo(
    () =>
      (series.data?.rows ?? []).map((r) => ({
        day: r.day as string,
        repos_reviewed: Number(r.repos_reviewed || 0),
      })),
    [series.data],
  );

  const breakdownByDay = useMemo(() => {
    const map = new Map<string, { label: string; value: number }[]>();
    for (const r of breakdown.data?.rows ?? []) {
      const day = r.day as string;
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push({
        label: String(r.repo_full_name),
        value: Number(r.prs_reviewed || 0),
      });
    }
    return map;
  }, [breakdown.data]);

  const handleClick = useCallback(
    (data: Record<string, unknown>, _index: number, e: React.MouseEvent) => {
      const day = data.day as string;
      const rows = breakdownByDay.get(day) ?? [];
      setPopover({ x: e.clientX, y: e.clientY, day, rows });
    },
    [breakdownByDay],
  );

  const closePopover = useCallback(() => setPopover(null), []);

  return (
    <Card className="bg-card border-border/50 relative">
      <CardHeader className="pb-2">
        <ChartTitleWithInfo
          title="Repos Reviewed per Day"
          description="Number of distinct repositories that had at least one PR reviewed by the bot each day. Click a bar to see which repos were reviewed."
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
                <Bar
                  dataKey="repos_reviewed"
                  name="Repos Reviewed"
                  fill="#06b6d4"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                  cursor="pointer"
                  onClick={handleClick}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
      <ChartPopover state={popover} onClose={closePopover} valueLabel="PRs" />
    </Card>
  );
}
