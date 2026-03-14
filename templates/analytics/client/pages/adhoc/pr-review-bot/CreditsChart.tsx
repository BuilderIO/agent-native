import { useMemo, useState, useCallback } from "react";
import {
  Bar,
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
  creditsPerDaySql,
  creditsPerPrByDaySql,
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

export function CreditsChart({ dateRange }: Props) {
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const series = useMetricsQuery(
    ["pr-review-credits-per-day", dateRange],
    creditsPerDaySql(dateRange)
  );

  const prBreakdown = useMetricsQuery(
    ["pr-review-credits-per-pr-by-day", dateRange],
    creditsPerPrByDaySql(dateRange)
  );

  const chartData = useMemo(
    () =>
      (series.data?.rows ?? []).map((r) => ({
        day: r.day as string,
        total_credits: Number(r.total_credits || 0),
        avg_credits_per_review: Number(r.avg_credits_per_review || 0),
        reviews: Number(r.reviews || 0),
      })),
    [series.data]
  );

  const breakdownByDay = useMemo(() => {
    const map = new Map<string, { label: string; value: number }[]>();
    for (const r of prBreakdown.data?.rows ?? []) {
      const day = r.day as string;
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push({
        label: String(r.pr_label),
        value: Number(r.credits || 0),
      });
    }
    // Sort each day descending by credits
    for (const [, rows] of map) {
      rows.sort((a, b) => b.value - a.value);
    }
    return map;
  }, [prBreakdown.data]);

  const handleBarClick = useCallback(
    (data: Record<string, unknown>, _index: number, e: React.MouseEvent) => {
      const day = data.day as string;
      const rows = breakdownByDay.get(day) ?? [];
      setPopover({ x: e.clientX, y: e.clientY, day, rows });
    },
    [breakdownByDay]
  );

  const closePopover = useCallback(() => setPopover(null), []);

  const totals = useMemo(() => {
    const totalCredits = chartData.reduce((s, r) => s + r.total_credits, 0);
    const totalReviews = chartData.reduce((s, r) => s + r.reviews, 0);
    return {
      totalCredits: Math.round(totalCredits).toLocaleString(),
      avgPerReview:
        totalReviews > 0 ? (totalCredits / totalReviews).toFixed(1) : "0",
    };
  }, [chartData]);

  const loading = series.isLoading;
  const empty = !loading && chartData.length === 0;

  return (
    <>
      {/* Average credits per PR review */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <ChartTitleWithInfo
              title="Avg Builder Credits per PR Review"
              description="Average Builder credits consumed per PR review each day. Includes all LLM calls (main review + sub-agents). Click a bar to see per-PR breakdown."
            />
            {!loading && (
              <span className="text-sm text-muted-foreground">
                Overall avg:{" "}
                <span className="text-foreground font-medium">
                  {totals.avgPerReview}
                </span>{" "}
                credits
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : empty ? (
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
                  <YAxis yAxisId="left" {...CHART_AXIS_STYLE} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    {...CHART_AXIS_STYLE}
                    allowDecimals={false}
                  />
                  <CartesianGrid {...GRID_STYLE} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={formatDate}
                    formatter={(value: number, name: string) => {
                      if (name === "Reviews") return [value, name];
                      return [value.toFixed(1), name];
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                  />
                  <Bar
                    dataKey="avg_credits_per_review"
                    name="Avg Credits / Review"
                    fill="#06b6d4"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                    fillOpacity={0.8}
                    yAxisId="left"
                    cursor="pointer"
                    onClick={handleBarClick}
                  />
                  <Line
                    type="monotone"
                    dataKey="reviews"
                    name="Reviews"
                    stroke="#a1a1aa"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    yAxisId="right"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
        <ChartPopover
          state={popover}
          onClose={closePopover}
          valueLabel="Credits"
          decimal
        />
      </Card>

      {/* Total credits per day */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <ChartTitleWithInfo
              title="Total Builder Credits Consumed per Day"
              description="Total Builder credits consumed by all PR reviews on a given day. The dashed line shows the number of reviews for context."
            />
            {!loading && (
              <span className="text-sm text-muted-foreground">
                Period total:{" "}
                <span className="text-foreground font-medium">
                  {totals.totalCredits}
                </span>{" "}
                credits
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : empty ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No data available
            </p>
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <defs>
                    <linearGradient
                      id="total-credits-grad"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#a78bfa"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="#a78bfa"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    {...CHART_AXIS_STYLE}
                    tickFormatter={formatDate}
                  />
                  <YAxis yAxisId="left" {...CHART_AXIS_STYLE} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    {...CHART_AXIS_STYLE}
                    allowDecimals={false}
                  />
                  <CartesianGrid {...GRID_STYLE} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={formatDate}
                    formatter={(value: number, name: string) => {
                      if (name === "Reviews") return [value, name];
                      return [Math.round(value).toLocaleString(), name];
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                  />
                  <Bar
                    dataKey="total_credits"
                    name="Total Credits"
                    fill="#a78bfa"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                    fillOpacity={0.8}
                    yAxisId="left"
                  />
                  <Line
                    type="monotone"
                    dataKey="reviews"
                    name="Reviews"
                    stroke="#a1a1aa"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    yAxisId="right"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
