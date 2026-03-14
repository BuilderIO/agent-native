import { useState, useMemo, useEffect } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { useMetricsQuery } from "@/lib/query-metrics";
import { KpiChart } from "./KpiChart";
import {
  signupToPaidQuery,
  signupToPaidByPlanQuery,
  wauQuery,
  arpaQuery,
  retentionSummaryQuery,
  signupRetentionQuery,
} from "./queries";
import type { DateCadence } from "./types";
import { formatPercent, formatCurrency, formatNumber, getToday } from "./types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function useUrlParam(
  key: string,
  defaultValue: string,
): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) || defaultValue;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (value === defaultValue) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const s = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${s ? `?${s}` : ""}`,
    );
  }, [value, key, defaultValue]);

  return [value, setValue];
}

export default function ProductKpisDashboard() {
  const [cadence, setCadence] = useUrlParam("cadence", "Weekly");
  const [dateStart, setDateStart] = useUrlParam("from", "2026-01-01");
  const [dateEnd, setDateEnd] = useUrlParam("to", getToday());
  const [planFilter, setPlanFilter] = useUrlParam("plan", "self-serve");

  const dc = cadence as DateCadence;

  // Signup → Paid Conversion
  const convSql = useMemo(
    () => signupToPaidQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd],
  );
  const convData = useMetricsQuery(["kpi-conv", convSql], convSql);

  const planSql = useMemo(
    () => signupToPaidByPlanQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd],
  );
  const planData = useMetricsQuery(["kpi-plan", planSql], planSql);

  // WAU
  const wauSql = useMemo(
    () => wauQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd],
  );
  const wauData = useMetricsQuery(["kpi-wau", wauSql], wauSql);

  // ARPA
  const arpaSql = useMemo(
    () => arpaQuery(dc, dateStart, dateEnd, planFilter),
    [dc, dateStart, dateEnd, planFilter],
  );
  const arpaData = useMetricsQuery(["kpi-arpa", arpaSql], arpaSql);

  // Retention
  const retSql = useMemo(
    () => retentionSummaryQuery(dateStart, dateEnd),
    [dateStart, dateEnd],
  );
  const retData = useMetricsQuery(["kpi-ret", retSql], retSql);

  const sigRetSql = useMemo(
    () => signupRetentionQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd],
  );
  const sigRetData = useMetricsQuery(["kpi-sigret", sigRetSql], sigRetSql);

  // Latest values for headline KPIs
  const latestConversion = useMemo(() => {
    const rows = convData.data?.rows ?? [];
    if (rows.length === 0) return undefined;
    const last = rows[rows.length - 1];
    return formatPercent(Number(last.conversion_rate ?? 0));
  }, [convData.data]);

  const latestWau = useMemo(() => {
    const rows = wauData.data?.rows ?? [];
    if (rows.length === 0) return undefined;
    const last = rows[rows.length - 1];
    return formatNumber(Number(last.active_users ?? 0));
  }, [wauData.data]);

  const latestArpa = useMemo(() => {
    const rows = arpaData.data?.rows ?? [];
    if (rows.length === 0) return undefined;
    const last = rows[rows.length - 1];
    return formatCurrency(Number(last.arpa ?? 0));
  }, [arpaData.data]);

  const latestRetention = useMemo(() => {
    const rows = sigRetData.data?.rows ?? [];
    if (rows.length === 0) return undefined;
    // Find last cohort with meaningful retention (skip trailing zeros from incomplete cohorts)
    for (let i = rows.length - 1; i >= 0; i--) {
      const rate = Number(rows[i].retention_rate ?? 0);
      if (rate > 0) return formatPercent(rate);
    }
    return formatPercent(0);
  }, [sigRetData.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Self-Serve Product KPIs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Key performance indicators for the self-serve product motion
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Cadence
            </label>
            <Select value={cadence} onValueChange={setCadence}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Weekly", "Monthly", "Quarterly"].map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              From
            </label>
            <DatePicker value={dateStart} onChange={setDateStart} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              To
            </label>
            <DatePicker value={dateEnd} onChange={setDateEnd} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Plan
            </label>
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All Plans
                </SelectItem>
                <SelectItem value="self-serve" className="text-xs">
                  Self-Serve
                </SelectItem>
                <SelectItem value="enterprise" className="text-xs">
                  Enterprise
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Row 1: Headline KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiChart
          title="Signup → Paid Conversion"
          subtitle="% of signups converting to paid plan"
          rows={convData.data?.rows ?? []}
          dataKey="conversion_rate"
          chartType="line"
          color="#10b981"
          isLoading={convData.isLoading}
          error={convData.data?.error}
          yFormatter={(v) => `${(v * 100).toFixed(1)}%`}
          latestValue={latestConversion}
        />
        <KpiChart
          title="30-Day Retention"
          subtitle="% of signups returning after first period"
          rows={sigRetData.data?.rows ?? []}
          dataKey="retention_rate"
          chartType="line"
          color="#f59e0b"
          isLoading={sigRetData.isLoading}
          error={sigRetData.data?.error}
          yFormatter={(v) => `${(v * 100).toFixed(1)}%`}
          latestValue={latestRetention}
        />
        <KpiChart
          title="Active Users"
          subtitle={`${cadence} active users`}
          rows={wauData.data?.rows ?? []}
          dataKey="active_users"
          chartType="area"
          color="#6366f1"
          isLoading={wauData.isLoading}
          error={wauData.data?.error}
          latestValue={latestWau}
        />
        <KpiChart
          title="ARPA"
          subtitle={`Average Revenue Per Account (${planFilter})`}
          rows={arpaData.data?.rows ?? []}
          dataKey="arpa"
          chartType="area"
          color="#8b5cf6"
          isLoading={arpaData.isLoading}
          error={arpaData.data?.error}
          yFormatter={(v) =>
            `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`
          }
          latestValue={latestArpa}
        />
      </div>

      {/* Row 2: Detail charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <KpiChart
          title="Total Signups"
          subtitle="New signups per period"
          rows={convData.data?.rows ?? []}
          dataKey="total_signups"
          chartType="bar"
          color="#3b82f6"
          isLoading={convData.isLoading}
          error={convData.data?.error}
        />
        <KpiChart
          title="Paid Signups"
          subtitle="Signups that converted to any paid plan"
          rows={convData.data?.rows ?? []}
          dataKey="paid_signups"
          chartType="bar"
          color="#10b981"
          isLoading={convData.isLoading}
          error={convData.data?.error}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <KpiChart
          title="Total ARR"
          subtitle={`Total annual recurring revenue (${planFilter})`}
          rows={arpaData.data?.rows ?? []}
          dataKey="total_arr"
          chartType="area"
          color="#ec4899"
          isLoading={arpaData.isLoading}
          error={arpaData.data?.error}
          yFormatter={(v) => {
            if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
            if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
            return `$${v.toFixed(0)}`;
          }}
        />
        <KpiChart
          title="Active Subscriptions"
          subtitle={`Number of paying subscriptions (${planFilter})`}
          rows={arpaData.data?.rows ?? []}
          dataKey="active_subs"
          chartType="area"
          color="#06b6d4"
          isLoading={arpaData.isLoading}
          error={arpaData.data?.error}
        />
      </div>

      {/* Row 3: Retention detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <KpiChart
          title="Cohort Retention (4 weeks)"
          subtitle="% of first-publish-week cohort still active at week 4 (2023 data)"
          rows={retData.data?.rows ?? []}
          dataKey="retention_4w"
          chartType="line"
          color="#f97316"
          isLoading={retData.isLoading}
          error={retData.data?.error}
          yFormatter={(v) => `${(v * 100).toFixed(0)}%`}
        />
        <KpiChart
          title="Cohort Retention (12 weeks)"
          subtitle="% of first-publish-week cohort still active at week 12 (2023 data)"
          rows={retData.data?.rows ?? []}
          dataKey="retention_12w"
          chartType="line"
          color="#ef4444"
          isLoading={retData.isLoading}
          error={retData.data?.error}
          yFormatter={(v) => `${(v * 100).toFixed(0)}%`}
        />
      </div>

      {/* Definitions */}
      <div className="rounded-lg border border-border/50 p-3 text-xs text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">Signup → Paid</span> — %
          of signups whose top_subscription is not &quot;free&quot;
        </p>
        <p>
          <span className="font-medium text-foreground">30-Day Retention</span>{" "}
          — % of cohort signups who had any active_users event after their
          signup period
        </p>
        <p>
          <span className="font-medium text-foreground">Active Users</span> —
          Distinct users with any activity event in the period
        </p>
        <p>
          <span className="font-medium text-foreground">ARPA</span> — Total ARR
          / active subscriptions for the selected plan type
        </p>
      </div>
    </div>
  );
}
