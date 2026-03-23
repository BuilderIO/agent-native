import { useState, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import { cn } from "@/lib/utils";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import {
  type DateRange,
  DATE_RANGES,
  prsReviewedSql,
  kpiSql,
  formatDate,
  CHART_AXIS_STYLE,
  TOOLTIP_STYLE,
  GRID_STYLE,
} from "./queries";
import { ReposPerDayChart } from "./ReposPerDayChart";
import { IssuesBySeverityChart } from "./IssuesBySeverityChart";
import { PostedVsResolvedChart } from "./PostedVsResolvedChart";
import { FeedbackChart } from "./FeedbackChart";
import { CreditsChart } from "./CreditsChart";
import { ChartTitleWithInfo } from "./ChartTitle";

function KpiCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="pt-4 pb-3 px-4">
        {loading ? (
          <Skeleton className="h-8 w-20 mb-1" />
        ) : (
          <p className="text-2xl font-bold tracking-tight">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

export default function PRReviewBotDashboard() {
  const [dateRange, setDateRange] = useState<DateRange>("30d");

  const timeSeries = useMetricsQuery(
    ["pr-review-prs-reviewed", dateRange],
    prsReviewedSql(dateRange),
  );

  const kpis = useMetricsQuery(
    ["pr-review-kpis", dateRange],
    kpiSql(dateRange),
  );

  const chartData = useMemo(() => {
    return (timeSeries.data?.rows ?? []).map((row) => ({
      day: row.day as string,
      prs_reviewed: Number(row.prs_reviewed || 0),
    }));
  }, [timeSeries.data]);

  const kpiRow = kpis.data?.rows?.[0];
  const kpiLoading = kpis.isLoading;

  return (
    <div className="space-y-6">
      <DashboardHeader
        description="Metrics on the automated code review agent"
        actions={
          <div className="flex items-center border rounded-md p-0.5 gap-0.5">
            {DATE_RANGES.map((opt) => (
              <Button
                key={opt.value}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-2 text-xs",
                  dateRange === opt.value && "bg-accent text-accent-foreground",
                )}
                onClick={() => setDateRange(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Unique PRs Reviewed"
          value={Number(kpiRow?.unique_prs_reviewed ?? 0)}
          loading={kpiLoading}
        />
        <KpiCard
          label="Total Reviews"
          value={Number(kpiRow?.total_reviews ?? 0)}
          loading={kpiLoading}
        />
        <KpiCard
          label="Issues Posted"
          value={Number(kpiRow?.total_issues_posted ?? 0)}
          loading={kpiLoading}
        />
        <KpiCard
          label="Issues Resolved"
          value={Number(kpiRow?.total_resolved ?? 0)}
          loading={kpiLoading}
        />
      </div>

      {/* PRs Reviewed over time */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <ChartTitleWithInfo
            title="PRs Reviewed per Day"
            description="Number of unique pull requests reviewed by the bot each day. A single PR with multiple review iterations is counted once."
          />
        </CardHeader>
        <CardContent>
          {timeSeries.isLoading ? (
            <Skeleton className="h-[350px] w-full" />
          ) : timeSeries.data?.error ? (
            <p className="text-sm text-red-400 py-8 text-center">
              {timeSeries.data.error}
            </p>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No data available
            </p>
          ) : (
            <div className="h-[350px] w-full">
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
                    dataKey="prs_reviewed"
                    name="PRs Reviewed"
                    fill="#8b5cf6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Repos reviewed per day */}
      <ReposPerDayChart dateRange={dateRange} />

      {/* Issues by severity */}
      <IssuesBySeverityChart dateRange={dateRange} />

      {/* Posted vs Resolved */}
      <PostedVsResolvedChart dateRange={dateRange} />

      {/* Builder Credits */}
      <CreditsChart dateRange={dateRange} />

      {/* Reaction feedback */}
      <FeedbackChart dateRange={dateRange} />
    </div>
  );
}
