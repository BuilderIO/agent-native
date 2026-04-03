import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { TimeSeriesChart } from "@/components/dashboard/TimeSeriesChart";
import {
  DateRangePicker,
  dateRangeToInterval,
  type DateRange,
} from "@/components/dashboard/DateRangePicker";
import { getIdToken } from "@/lib/auth";
import { IconUsers, IconClick, IconArrowLeftRight } from "@tabler/icons-react";
import { fetchGA4Report, type GA4ReportResponse } from "./queries";

const DATE_RANGE_KEY = "ga4_date_range";

function loadDateRange(): DateRange {
  const saved = localStorage.getItem(DATE_RANGE_KEY);
  if (saved === "7d" || saved === "30d" || saved === "90d") return saved;
  return "30d";
}

function useEnvStatus() {
  return useQuery({
    queryKey: ["env-status"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetch("/api/credential-status", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      return res.json() as Promise<{ key: string; configured: boolean }[]>;
    },
    staleTime: 60_000,
  });
}

function isGA4Configured(
  envStatus: { key: string; configured: boolean }[] | undefined,
): boolean {
  if (!envStatus) return false;
  const map = new Map(envStatus.map((s) => [s.key, s.configured]));
  return (
    map.get("GA4_PROPERTY_ID") === true &&
    map.get("GOOGLE_APPLICATION_CREDENTIALS_JSON") === true
  );
}

function sumMetric(report: GA4ReportResponse | undefined, index = 0): number {
  if (!report?.rows) return 0;
  return report.rows.reduce(
    (sum, row) => sum + parseInt(row.metricValues[index]?.value ?? "0", 10),
    0,
  );
}

function formatDate(raw: string): string {
  // GA4 returns dates as YYYYMMDD
  if (raw.length === 8) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return raw;
}

function NotConfiguredBanner() {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="py-12 text-center">
        <h3 className="text-lg font-semibold mb-2">Connect Google Analytics</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          Set up your GA4 property ID and Google service account credentials to
          see your website metrics here.
        </p>
        <Link
          to="/data-sources"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          Go to Data Sources
        </Link>
      </CardContent>
    </Card>
  );
}

function TopPagesTable({
  data,
  isLoading,
}: {
  data: GA4ReportResponse | undefined;
  isLoading: boolean;
}) {
  if (isLoading) return <Skeleton className="h-[300px] w-full" />;

  const rows = (data?.rows ?? [])
    .map((row) => ({
      path: row.dimensionValues[0]?.value ?? "",
      pageviews: parseInt(row.metricValues[0]?.value ?? "0", 10),
      users: parseInt(row.metricValues[1]?.value ?? "0", 10),
    }))
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, 10);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No data available
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">
              Page
            </th>
            <th className="text-right py-2 px-4 font-medium text-muted-foreground">
              Views
            </th>
            <th className="text-right py-2 pl-4 font-medium text-muted-foreground">
              Users
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-b border-border/30">
              <td className="py-2 pr-4 truncate max-w-[300px]" title={row.path}>
                {row.path}
              </td>
              <td className="py-2 px-4 text-right tabular-nums">
                {row.pageviews.toLocaleString()}
              </td>
              <td className="py-2 pl-4 text-right tabular-nums">
                {row.users.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceChart({
  data,
  isLoading,
}: {
  data: GA4ReportResponse | undefined;
  isLoading: boolean;
}) {
  if (isLoading) return <Skeleton className="h-[300px] w-full" />;

  const rows = (data?.rows ?? [])
    .map((row) => ({
      source: row.dimensionValues[0]?.value || "(direct)",
      sessions: parseInt(row.metricValues[0]?.value ?? "0", 10),
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 8);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No data available
      </p>
    );
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 80 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            horizontal={false}
          />
          <XAxis
            type="number"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="source"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={80}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
            }}
          />
          <Bar dataKey="sessions" fill="#6366f1" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CountryTable({
  data,
  isLoading,
}: {
  data: GA4ReportResponse | undefined;
  isLoading: boolean;
}) {
  if (isLoading) return <Skeleton className="h-[300px] w-full" />;

  const rows = (data?.rows ?? [])
    .map((row) => ({
      country: row.dimensionValues[0]?.value ?? "",
      users: parseInt(row.metricValues[0]?.value ?? "0", 10),
    }))
    .sort((a, b) => b.users - a.users)
    .slice(0, 10);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No data available
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">
              Country
            </th>
            <th className="text-right py-2 pl-4 font-medium text-muted-foreground">
              IconUsers
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.country} className="border-b border-border/30">
              <td className="py-2 pr-4">{row.country}</td>
              <td className="py-2 pl-4 text-right tabular-nums">
                {row.users.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GoogleAnalyticsDashboard() {
  const [range, setRange] = useState<DateRange>(loadDateRange);
  const handleRangeChange = (r: DateRange) => {
    setRange(r);
    localStorage.setItem(DATE_RANGE_KEY, r);
  };
  const days = dateRangeToInterval(range);

  const { data: envStatus, isLoading: envLoading } = useEnvStatus();
  const configured = isGA4Configured(envStatus);

  // Totals: sessions, active users, bounce rate
  const totals = useQuery({
    queryKey: ["ga4-totals", days],
    queryFn: () =>
      fetchGA4Report({
        metrics: ["activeUsers", "sessions", "bounceRate"],
        dimensions: [],
        days,
      }),
    enabled: configured,
  });

  // Sessions over time
  const sessionsOverTime = useQuery({
    queryKey: ["ga4-sessions-time", days],
    queryFn: () =>
      fetchGA4Report({
        metrics: ["sessions"],
        dimensions: ["date"],
        days,
      }),
    enabled: configured,
  });

  // Top pages
  const topPages = useQuery({
    queryKey: ["ga4-top-pages", days],
    queryFn: () =>
      fetchGA4Report({
        metrics: ["screenPageViews", "activeUsers"],
        dimensions: ["pagePath"],
        days,
      }),
    enabled: configured,
  });

  // Sessions by source
  const sessionsBySource = useQuery({
    queryKey: ["ga4-sources", days],
    queryFn: () =>
      fetchGA4Report({
        metrics: ["sessions"],
        dimensions: ["sessionSource"],
        days,
      }),
    enabled: configured,
  });

  // IconUsers by country
  const usersByCountry = useQuery({
    queryKey: ["ga4-countries", days],
    queryFn: () =>
      fetchGA4Report({
        metrics: ["activeUsers"],
        dimensions: ["country"],
        days,
      }),
    enabled: configured,
  });

  if (envLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">Google Analytics</h2>
        <NotConfiguredBanner />
      </div>
    );
  }

  const activeUsers = totals.data?.rows?.[0]
    ? parseInt(totals.data.rows[0].metricValues[0]?.value ?? "0", 10)
    : null;
  const sessions = totals.data?.rows?.[0]
    ? parseInt(totals.data.rows[0].metricValues[1]?.value ?? "0", 10)
    : null;
  const bounceRate = totals.data?.rows?.[0]
    ? parseFloat(totals.data.rows[0].metricValues[2]?.value ?? "0")
    : null;

  const sessionsChartData = (sessionsOverTime.data?.rows ?? [])
    .map((row) => ({
      date: formatDate(row.dimensionValues[0].value),
      sessions: parseInt(row.metricValues[0].value, 10),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Google Analytics</h2>
        <DateRangePicker value={range} onChange={handleRangeChange} />
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Active Users"
          value={activeUsers}
          icon={IconUsers}
          isLoading={totals.isLoading}
          error={totals.error?.message}
          description={`Last ${days} days`}
        />
        <MetricCard
          title="Sessions"
          value={sessions}
          icon={IconClick}
          isLoading={totals.isLoading}
          error={totals.error?.message}
          description={`Last ${days} days`}
        />
        <MetricCard
          title="Bounce Rate"
          value={
            bounceRate != null ? `${(bounceRate * 100).toFixed(1)}%` : null
          }
          icon={IconArrowLeftRight}
          isLoading={totals.isLoading}
          error={totals.error?.message}
          description={`Last ${days} days`}
        />
      </div>

      {/* Sessions over time */}
      <TimeSeriesChart
        title="Sessions Over Time"
        data={sessionsChartData}
        xKey="date"
        yKey="sessions"
        color="#6366f1"
        isLoading={sessionsOverTime.isLoading}
        error={sessionsOverTime.error?.message}
      />

      {/* Bottom grid: Top Pages + Sources + Countries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Pages</CardTitle>
          </CardHeader>
          <CardContent>
            <TopPagesTable
              data={topPages.data}
              isLoading={topPages.isLoading}
            />
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sessions by Source</CardTitle>
          </CardHeader>
          <CardContent>
            <SourceChart
              data={sessionsBySource.data}
              isLoading={sessionsBySource.isLoading}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Users by Country</CardTitle>
        </CardHeader>
        <CardContent>
          <CountryTable
            data={usersByCountry.data}
            isLoading={usersByCountry.isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
