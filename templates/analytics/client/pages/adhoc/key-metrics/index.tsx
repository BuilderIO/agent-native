import { useMemo, useState } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { KpiChart } from "../product-kpis/KpiChart";
import { SiteTrafficChart } from "./SiteTrafficChart";
import { NewVsCancelledChart } from "./NewVsCancelledChart";
import { SqlEditorModal } from "./SqlEditorModal";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  siteTrafficQuery,
  siteTrafficAmplitudeQuery,
  dailySignupsQuery,
  hourlySignupsQuery,
  newVsCancelledSubsQuery,
} from "./queries";

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function get90DaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

function get30DaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function get7DaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export default function KeyMetricsDashboard() {
  // Date filter state
  const [dateRange, setDateRange] = useState<string>("90");
  const [customStartDate, setCustomStartDate] =
    useState<string>(get90DaysAgo());
  const [customEndDate, setCustomEndDate] = useState<string>(getToday());
  const [cadence, setCadence] = useState<string>("daily");

  // Calculate date range based on selection
  const { dateStart, dateEnd } = useMemo(() => {
    const end = getToday();
    let start: string;

    switch (dateRange) {
      case "7":
        start = get7DaysAgo();
        break;
      case "30":
        start = get30DaysAgo();
        break;
      case "90":
        start = get90DaysAgo();
        break;
      case "custom":
        start = customStartDate;
        return { dateStart: customStartDate, dateEnd: customEndDate };
      default:
        start = get90DaysAgo();
    }

    return { dateStart: start, dateEnd: end };
  }, [dateRange, customStartDate, customEndDate]);

  // Modal state
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // Custom SQL state - allows user to override default queries
  const [customTrafficSql, setCustomTrafficSql] = useState<string | null>(null);
  const [customTrafficAmplitudeSql, setCustomTrafficAmplitudeSql] = useState<
    string | null
  >(null);
  const [customDailySignupsSql, setCustomDailySignupsSql] = useState<
    string | null
  >(null);
  const [customHourlySignupsSql, setCustomHourlySignupsSql] = useState<
    string | null
  >(null);
  const [customNewVsCancelledSql, setCustomNewVsCancelledSql] = useState<
    string | null
  >(null);

  // Default SQL queries - using direct calls instead of useMemo to ensure fresh queries
  const defaultTrafficSql = siteTrafficQuery(dateStart, dateEnd, cadence);
  const defaultTrafficAmplitudeSql = siteTrafficAmplitudeQuery(
    dateStart,
    dateEnd,
    cadence,
  );
  const defaultDailySignupsSql = dailySignupsQuery(dateStart, dateEnd, cadence);
  const defaultHourlySignupsSql = hourlySignupsQuery();
  const defaultNewVsCancelledSql = newVsCancelledSubsQuery(
    dateStart,
    dateEnd,
    cadence,
  );

  // Use custom SQL if provided, otherwise use default
  const trafficSql = customTrafficSql ?? defaultTrafficSql;
  const trafficAmplitudeSql =
    customTrafficAmplitudeSql ?? defaultTrafficAmplitudeSql;
  const dailySignupsSql = customDailySignupsSql ?? defaultDailySignupsSql;
  const hourlySignupsSql = customHourlySignupsSql ?? defaultHourlySignupsSql;
  const newVsCancelledSql = customNewVsCancelledSql ?? defaultNewVsCancelledSql;

  const trafficData = useMetricsQuery(
    ["key-metrics-traffic", cadence, dateStart, dateEnd, trafficSql],
    trafficSql,
  );
  const trafficAmplitudeData = useMetricsQuery(
    [
      "key-metrics-traffic-amplitude",
      cadence,
      dateStart,
      dateEnd,
      trafficAmplitudeSql,
    ],
    trafficAmplitudeSql,
  );
  const dailySignupsData = useMetricsQuery(
    ["key-metrics-daily-signups", cadence, dateStart, dateEnd, dailySignupsSql],
    dailySignupsSql,
  );
  const hourlySignupsData = useMetricsQuery(
    ["key-metrics-hourly-signups", hourlySignupsSql],
    hourlySignupsSql,
  );
  const newVsCancelledData = useMetricsQuery(
    [
      "key-metrics-new-vs-cancelled",
      cadence,
      dateStart,
      dateEnd,
      newVsCancelledSql,
    ],
    newVsCancelledSql,
  );

  // Debug logging
  console.log("Traffic SQL:", trafficSql);
  console.log("Traffic data:", trafficData.data);
  console.log("Daily Signups SQL:", dailySignupsSql);
  console.log("Daily Signups data:", dailySignupsData.data);
  console.log("Hourly Signups SQL:", hourlySignupsSql);
  console.log("Hourly Signups data:", hourlySignupsData.data);

  const formatHourly = (val: string) => {
    // Format timestamp as "MMM DD, HH:mm"
    const d = new Date(val);
    const month = d.toLocaleString("en-US", { month: "short" });
    const day = d.getDate();
    const hour = d.getHours().toString().padStart(2, "0");
    const minute = d.getMinutes().toString().padStart(2, "0");
    return `${month} ${day}, ${hour}:${minute}`;
  };

  return (
    <div className="space-y-6">
      <DashboardHeader description="Core product metrics — site traffic, signups, and subscription activity" />

      {/* Date and Cadence Filters */}
      <div className="rounded-lg border border-border/50 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Date Range Selector */}
          <div className="space-y-2">
            <Label htmlFor="date-range" className="text-xs font-medium">
              Date Range
            </Label>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger id="date-range">
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Cadence Selector */}
          <div className="space-y-2">
            <Label htmlFor="cadence" className="text-xs font-medium">
              Cadence
            </Label>
            <Select value={cadence} onValueChange={setCadence}>
              <SelectTrigger id="cadence">
                <SelectValue placeholder="Select cadence" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom Start Date */}
          {dateRange === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="start-date" className="text-xs font-medium">
                Start Date
              </Label>
              <Input
                id="start-date"
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                max={customEndDate}
              />
            </div>
          )}

          {/* Custom End Date */}
          {dateRange === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="end-date" className="text-xs font-medium">
                End Date
              </Label>
              <Input
                id="end-date"
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                min={customStartDate}
                max={getToday()}
              />
            </div>
          )}
        </div>

        {/* Date range summary */}
        <div className="mt-3 text-xs text-muted-foreground">
          Showing data from{" "}
          <span className="font-mono font-medium">{dateStart}</span> to{" "}
          <span className="font-mono font-medium">{dateEnd}</span> ({cadence}{" "}
          cadence)
        </div>
      </div>

      {/* Site Traffic Comparison - 2 data sources side by side */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Site Traffic Comparison</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <SiteTrafficChart
            title="Site Traffic (all_pageviews)"
            rows={trafficData.data?.rows ?? []}
            isLoading={trafficData.isLoading}
            error={trafficData.data?.error}
            onEditSql={() => setActiveModal("traffic")}
          />

          <SiteTrafficChart
            title="Site Traffic (Amplitude events_partitioned)"
            rows={trafficAmplitudeData.data?.rows ?? []}
            isLoading={trafficAmplitudeData.isLoading}
            error={trafficAmplitudeData.data?.error}
            onEditSql={() => setActiveModal("traffic-amplitude")}
          />
        </div>
      </div>

      {/* Other Key Metrics - 3 charts */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Signups & Subscriptions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <KpiChart
            title="Daily Signups"
            subtitle="Last 90 Days • Totals"
            rows={dailySignupsData.data?.rows ?? []}
            dataKey="signups"
            chartType="line"
            color="#3b82f6"
            isLoading={dailySignupsData.isLoading}
            error={dailySignupsData.data?.error}
            onEditSql={() => setActiveModal("daily-signups")}
          />

          <KpiChart
            title="Hourly Signups"
            subtitle="Last 7 Days • Totals"
            rows={hourlySignupsData.data?.rows ?? []}
            dataKey="signups"
            chartType="line"
            color="#3b82f6"
            isLoading={hourlySignupsData.isLoading}
            error={hourlySignupsData.data?.error}
            yFormatter={(v) => String(v)}
            onEditSql={() => setActiveModal("hourly-signups")}
          />

          <NewVsCancelledChart
            rows={newVsCancelledData.data?.rows ?? []}
            isLoading={newVsCancelledData.isLoading}
            error={newVsCancelledData.data?.error}
            onEditSql={() => setActiveModal("new-vs-cancelled")}
          />
        </div>
      </div>

      {/* Top Traffic Days Analysis */}
      {trafficData.data?.rows && trafficData.data.rows.length > 0 && (
        <div className="rounded-lg border border-border/50 p-4">
          <h3 className="text-sm font-semibold mb-3">
            Top 10 Traffic Days (Last 90 Days)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border">
                <tr className="text-muted-foreground text-left">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium text-right">Not Blog</th>
                  <th className="pb-2 font-medium text-right">Blog</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {trafficData.data.rows
                  .map((row: any) => ({
                    ...row,
                    total: Number(row.not_blog) + Number(row.blog),
                  }))
                  .sort((a: any, b: any) => b.total - a.total)
                  .slice(0, 10)
                  .map((row: any, i: number) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 font-mono">{String(row.period)}</td>
                      <td className="py-2 text-right font-mono">
                        {Number(row.not_blog).toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {Number(row.blog).toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-mono font-semibold">
                        {row.total.toLocaleString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Definitions */}
      <div className="rounded-lg border border-border/50 p-3 text-xs text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">Site traffic</span> —
          Unique page views on your site, segmented by blog vs non-blog pages.
          Excludes internal @your-company.com users.
        </p>
        <p>
          <span className="font-medium text-foreground">Daily Signups</span> —
          Account signup events per day. Excludes @your-company.com emails and
          India-based signups.
        </p>
        <p>
          <span className="font-medium text-foreground">Hourly Signups</span> —
          Account signup events aggregated by hour for the last 7 days. Excludes
          @your-company.com emails and India-based signups.
        </p>
        <p>
          <span className="font-medium text-foreground">
            New subs vs cancelled
          </span>{" "}
          — Daily count of new subscription payment successes vs subscription
          plan cancellations. Excludes @your-company.com, qq.com emails and
          India-based events.
        </p>
      </div>

      {/* SQL Editor Modals */}
      <SqlEditorModal
        isOpen={activeModal === "traffic"}
        onClose={() => setActiveModal(null)}
        title="Site Traffic SQL (all_pageviews)"
        initialSql={defaultTrafficSql}
        onExecute={(sql) => setCustomTrafficSql(sql)}
      />
      <SqlEditorModal
        isOpen={activeModal === "traffic-amplitude"}
        onClose={() => setActiveModal(null)}
        title="Site Traffic SQL (Amplitude events_partitioned)"
        initialSql={defaultTrafficAmplitudeSql}
        onExecute={(sql) => setCustomTrafficAmplitudeSql(sql)}
      />
      <SqlEditorModal
        isOpen={activeModal === "daily-signups"}
        onClose={() => setActiveModal(null)}
        title="Daily Signups SQL"
        initialSql={defaultDailySignupsSql}
        onExecute={(sql) => setCustomDailySignupsSql(sql)}
      />
      <SqlEditorModal
        isOpen={activeModal === "hourly-signups"}
        onClose={() => setActiveModal(null)}
        title="Hourly Signups SQL"
        initialSql={defaultHourlySignupsSql}
        onExecute={(sql) => setCustomHourlySignupsSql(sql)}
      />
      <SqlEditorModal
        isOpen={activeModal === "new-vs-cancelled"}
        onClose={() => setActiveModal(null)}
        title="New Subs vs Cancelled SQL"
        initialSql={defaultNewVsCancelledSql}
        onExecute={(sql) => setCustomNewVsCancelledSql(sql)}
      />
    </div>
  );
}
