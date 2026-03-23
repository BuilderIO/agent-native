import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import { summaryTotalsQuery } from "./queries";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: number | null) => {
  if (v == null) return "-";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
};

const fmtFull = (v: number | null) => {
  if (v == null) return "-";
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

interface SummaryCardsProps {
  fiscalYear: number;
}

export function SummaryCards({ fiscalYear }: SummaryCardsProps) {
  const sql = summaryTotalsQuery(fiscalYear);
  const { data, isLoading } = useMetricsQuery(
    ["arr-summary", String(fiscalYear)],
    sql,
  );

  const row = data?.rows?.[0];
  const revenueIn = row ? Number(row.total_revenue_in || 0) : null;
  const churnOut = row ? Number(row.total_churn_out || 0) : null;
  const net = row ? Number(row.total_net || 0) : null;
  const events = row ? Number(row.total_events || 0) : null;
  const customers = row ? Number(row.unique_customers || 0) : null;
  const isPositive = net !== null && net >= 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Revenue In (ARR)"
        value={revenueIn}
        formatter={fmtFull}
        icon={ArrowUpRight}
        color="text-emerald-500"
        bgColor="bg-emerald-500/10"
        description="New + Expansion + Reactivation"
        isLoading={isLoading}
        error={data?.error}
      />
      <MetricCard
        title="Churn Out (ARR)"
        value={churnOut}
        formatter={fmtFull}
        icon={ArrowDownRight}
        color="text-red-500"
        bgColor="bg-red-500/10"
        description="Churn + Downgrade"
        isLoading={isLoading}
        error={data?.error}
      />
      <Card
        className={cn(
          "bg-card border-2",
          isLoading
            ? "border-border/50"
            : isPositive
              ? "border-emerald-500/30"
              : "border-red-500/30",
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Net ARR Change
          </CardTitle>
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full",
              isPositive ? "bg-emerald-500/10" : "bg-red-500/10",
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
          {isLoading ? (
            <Skeleton className="h-9 w-32" />
          ) : data?.error ? (
            <p className="text-sm text-red-400">{data.error}</p>
          ) : (
            <>
              <div
                className={cn(
                  "text-3xl font-bold",
                  isPositive ? "text-emerald-500" : "text-red-500",
                )}
              >
                {isPositive ? "+" : ""}
                {fmtFull(net)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isPositive ? "Net positive" : "Net negative"} for FY
                {fiscalYear}
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 grid-rows-2">
        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Events
            </CardTitle>
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <div className="text-xl font-bold">
                {events?.toLocaleString() ?? "-"}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Customers
            </CardTitle>
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <div className="text-xl font-bold">
                {customers?.toLocaleString() ?? "-"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  formatter,
  icon: Icon,
  color,
  bgColor,
  description,
  isLoading,
  error,
}: {
  title: string;
  value: number | null;
  formatter: (v: number | null) => string;
  icon: typeof ArrowUpRight;
  color: string;
  bgColor: string;
  description: string;
  isLoading?: boolean;
  error?: string;
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
            bgColor,
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
            <div className="text-2xl font-bold">{formatter(value)}</div>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
