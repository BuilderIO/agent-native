import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import { RevenueComparisonChart } from "@/components/dashboard/RevenueComparisonChart";
import { CumulativeNetChart } from "@/components/dashboard/CumulativeNetChart";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, DollarSign, ArrowDownRight, ArrowUpRight } from "lucide-react";

type Granularity = "daily" | "weekly";

const QUARTER_START = "2026-02-01";
const ARR_TABLE = "`builder-3b0a2.finance.arr_revenue_tracker_latest`";

function revenueOverTimeSql(granularity: Granularity) {
  const trunc = granularity === "weekly" ? "WEEK(MONDAY)" : "DAY";
  return `SELECT
  DATE_TRUNC(DATE(event_date_pst), ${trunc}) AS day,
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS revenue_in,
  SUM(CASE WHEN arr_change < 0 THEN ABS(arr_change) ELSE 0 END) AS churn_out,
  SUM(arr_change) AS net
FROM ${ARR_TABLE}
WHERE DATE(event_date_pst) >= '${QUARTER_START}'
  AND DATE(event_date_pst) <= CURRENT_DATE()
  AND LOWER(plan) LIKE '%self%'
GROUP BY day
ORDER BY day ASC`;
}

function quarterTotalsSql() {
  return `SELECT
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS total_revenue_in,
  SUM(CASE WHEN arr_change < 0 THEN ABS(arr_change) ELSE 0 END) AS total_churn_out,
  SUM(arr_change) AS total_net,
  COUNT(*) AS total_events
FROM ${ARR_TABLE}
WHERE DATE(event_date_pst) >= '${QUARTER_START}'
  AND DATE(event_date_pst) <= CURRENT_DATE()
  AND LOWER(plan) LIKE '%self%'`;
}

function breakdownByStatusSql() {
  return `SELECT
  status,
  SUM(arr_change) AS arr_change,
  COUNT(*) AS events
FROM ${ARR_TABLE}
WHERE DATE(event_date_pst) >= '${QUARTER_START}'
  AND DATE(event_date_pst) <= CURRENT_DATE()
  AND LOWER(plan) LIKE '%self%'
GROUP BY status
ORDER BY arr_change DESC`;
}

const formatCurrency = (value: number | null) => {
  if (value === null || value === undefined) return "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)
    return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
};

const formatFullCurrency = (value: number | null) => {
  if (value === null || value === undefined) return "-";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

export default function SelfServeRevenueDashboard() {
  const [granularity, setGranularity] = useState<Granularity>("daily");

  const overTimeSql = revenueOverTimeSql(granularity);
  const totalsSql = quarterTotalsSql();
  const statusSql = breakdownByStatusSql();

  const overTime = useMetricsQuery(
    ["ss-revenue-time", granularity],
    overTimeSql
  );
  const totals = useMetricsQuery(["ss-revenue-totals"], totalsSql);
  const statusBreakdown = useMetricsQuery(["ss-revenue-status"], statusSql);

  const totalRevenueIn = (totals.data?.rows?.[0]?.total_revenue_in as number) ?? null;
  const totalChurnOut = (totals.data?.rows?.[0]?.total_churn_out as number) ?? null;
  const totalNet = (totals.data?.rows?.[0]?.total_net as number) ?? null;

  const chartData = useMemo(() => {
    const rows = overTime.data?.rows ?? [];
    return rows.map((r) => ({
      day: r.day as string,
      revenue_in: Number(r.revenue_in || 0),
      churn_out: Number(r.churn_out || 0),
      net: Number(r.net || 0),
    }));
  }, [overTime.data]);

  const cumulativeData = useMemo(() => {
    let running = 0;
    return chartData.map((d) => {
      running += d.net;
      return { day: d.day, cumulative_net: Math.round(running) };
    });
  }, [chartData]);

  const isPositive = totalNet !== null && totalNet >= 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Self-Serve Revenue
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Q1 2026 (starting Feb 1) &mdash; Revenue in vs churn out
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {(["daily", "weekly"] as const).map((g) => (
            <Button
              key={g}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-3 text-xs capitalize",
                granularity === g && "bg-secondary text-secondary-foreground"
              )}
              onClick={() => setGranularity(g)}
            >
              {g}
            </Button>
          ))}
        </div>
      </div>

      {/* Quarter summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="Revenue In (ARR)"
          value={totalRevenueIn}
          icon={ArrowUpRight}
          color="text-emerald-500"
          bgColor="bg-emerald-500/10"
          isLoading={totals.isLoading}
          error={totals.data?.error}
          description="New + Expansion + Reactivation"
          sql={totalsSql}
        />
        <SummaryCard
          title="Churn Out (ARR)"
          value={totalChurnOut}
          icon={ArrowDownRight}
          color="text-red-500"
          bgColor="bg-red-500/10"
          isLoading={totals.isLoading}
          error={totals.data?.error}
          description="Churn + Downgrade"
          sql={totalsSql}
        />
        <Card
          className={cn(
            "bg-card border-2",
            totals.isLoading
              ? "border-border/50"
              : isPositive
                ? "border-emerald-500/30"
                : "border-red-500/30"
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Net Self-Serve (ARR)
            </CardTitle>
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full",
                isPositive ? "bg-emerald-500/10" : "bg-red-500/10"
              )}
            >
              {isPositive ? (
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {totals.isLoading ? (
              <Skeleton className="h-9 w-32" />
            ) : totals.data?.error ? (
              <p className="text-sm text-red-400">{totals.data.error}</p>
            ) : (
              <>
                <div
                  className={cn(
                    "text-3xl font-bold",
                    isPositive ? "text-emerald-500" : "text-red-500"
                  )}
                >
                  {isPositive ? "+" : ""}
                  {formatFullCurrency(totalNet)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {isPositive
                    ? "Pacing positive this quarter"
                    : "Pacing negative this quarter"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bar chart: revenue in vs churn out */}
      <RevenueComparisonChart
        title={`${granularity === "daily" ? "Daily" : "Weekly"} Revenue In vs Churn Out`}
        data={chartData}
        isLoading={overTime.isLoading}
        error={overTime.data?.error}
        sql={overTimeSql}
      />

      {/* Cumulative net chart */}
      <CumulativeNetChart
        title="Cumulative Net Self-Serve ARR (Q1 2026)"
        data={cumulativeData}
        isLoading={overTime.isLoading}
        error={overTime.data?.error}
        sql={overTimeSql}
      />

      {/* Status breakdown table */}
      <StatusBreakdownTable
        rows={statusBreakdown.data?.rows ?? []}
        isLoading={statusBreakdown.isLoading}
        error={statusBreakdown.data?.error}
        sql={statusSql}
      />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  color,
  bgColor,
  isLoading,
  error,
  description,
  sql,
}: {
  title: string;
  value: number | null;
  icon: typeof DollarSign;
  color: string;
  bgColor: string;
  isLoading?: boolean;
  error?: string;
  description: string;
  sql?: string;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full",
            bgColor
          )}
        >
          <Icon className={cn("h-4 w-4", color)} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <>
            <div className="text-2xl font-bold">
              {formatFullCurrency(value)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBreakdownTable({
  rows,
  isLoading,
  error,
  sql,
}: {
  rows: Record<string, unknown>[];
  isLoading?: boolean;
  error?: string;
  sql?: string;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Breakdown by Status</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <p className="text-sm text-red-400 text-center py-4">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No data
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                    ARR Change
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                    Events
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const arrChange = Number(row.arr_change || 0);
                  const isPos = arrChange >= 0;
                  return (
                    <tr
                      key={row.status as string}
                      className="border-b border-border/50"
                    >
                      <td className="py-2 px-3">
                        <StatusBadge status={row.status as string} />
                      </td>
                      <td
                        className={cn(
                          "py-2 px-3 text-right font-medium",
                          isPos ? "text-emerald-500" : "text-red-500"
                        )}
                      >
                        {isPos ? "+" : ""}
                        {formatFullCurrency(arrChange)}
                      </td>
                      <td className="py-2 px-3 text-right text-muted-foreground">
                        {Number(row.events || 0).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_COLORS: Record<string, string> = {
  New: "bg-emerald-500/15 text-emerald-500",
  Expansion: "bg-blue-500/15 text-blue-500",
  Reactivate: "bg-violet-500/15 text-violet-500",
  Churn: "bg-red-500/15 text-red-500",
  Downgrade: "bg-orange-500/15 text-orange-500",
  Unknown: "bg-zinc-500/15 text-zinc-500",
};

function StatusBadge({ status }: { status: string }) {
  const colorClass = STATUS_COLORS[status] ?? STATUS_COLORS.Unknown;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        colorClass
      )}
    >
      {status}
    </span>
  );
}
