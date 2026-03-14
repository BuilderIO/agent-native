import { useState, useMemo, useEffect } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { DatePicker } from "@/components/ui/date-picker";
import { KpiChart } from "../product-kpis/KpiChart";
import { SectionCard } from "./SectionCard";
import {
  qlsQuery,
  s1sQuery,
  s1sNamedAccountsQuery,
  landingAcvQuery,
  povWinRateQuery,
  aeCapacityQuery,
  expansionPipelineQuery,
  ndrQuery,
  seatUtilizationQuery,
  selfServeConversionQuery,
  selfServeRetentionQuery,
  selfServeWauQuery,
  selfServeArpaQuery,
} from "./queries";
import type { DateCadence } from "../product-kpis/types";
import {
  formatPercent,
  formatCurrency,
  formatNumber,
  getToday,
} from "../product-kpis/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── URL param helper ──────────────────────────────────────────────────

function useUrlParam(
  key: string,
  defaultValue: string
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
      `${window.location.pathname}${s ? `?${s}` : ""}`
    );
  }, [value, key, defaultValue]);

  return [value, setValue];
}

// ─── Helpers ───────────────────────────────────────────────────────────

function lastVal(
  rows: Record<string, unknown>[],
  key: string,
  fmt: (v: number) => string
): string | undefined {
  if (!rows.length) return undefined;
  return fmt(Number(rows[rows.length - 1][key] ?? 0));
}

function lastNonZero(
  rows: Record<string, unknown>[],
  key: string,
  fmt: (v: number) => string
): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = Number(rows[i][key] ?? 0);
    if (v > 0) return fmt(v);
  }
  return rows.length ? fmt(0) : undefined;
}

// ─── Component ─────────────────────────────────────────────────────────

export default function CompanyKpisDashboard() {
  const [cadence, setCadence] = useUrlParam("cadence", "Monthly");
  const [dateStart, setDateStart] = useUrlParam("from", "2026-01-01");
  const [dateEnd, setDateEnd] = useUrlParam("to", getToday());
  const dc = cadence as DateCadence;

  // ── TOFU & Pipeline ──────────────────────────────────────────────────
  const qlsSql = useMemo(() => qlsQuery(dc, dateStart, dateEnd), [dc, dateStart, dateEnd]);
  const qlsData = useMetricsQuery(["co-qls", qlsSql], qlsSql);

  const s1sSql = useMemo(() => s1sQuery(dc, dateStart, dateEnd), [dc, dateStart, dateEnd]);
  const s1sData = useMetricsQuery(["co-s1s", s1sSql], s1sSql);

  const s1sNamedSql = useMemo(
    () => s1sNamedAccountsQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd]
  );
  const s1sNamedData = useMetricsQuery(["co-s1sn", s1sNamedSql], s1sNamedSql);

  // ── Sales Productivity ───────────────────────────────────────────────
  const acvSql = useMemo(() => landingAcvQuery(dc, dateStart, dateEnd), [dc, dateStart, dateEnd]);
  const acvData = useMetricsQuery(["co-acv", acvSql], acvSql);

  const povSql = useMemo(
    () => povWinRateQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd]
  );
  const povData = useMetricsQuery(["co-pov", povSql], povSql);

  const aeSql = useMemo(
    () => aeCapacityQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd]
  );
  const aeData = useMetricsQuery(["co-ae", aeSql], aeSql);

  // ── Expansion ────────────────────────────────────────────────────────
  const expSql = useMemo(
    () => expansionPipelineQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd]
  );
  const expData = useMetricsQuery(["co-exp", expSql], expSql);

  const ndrSql = useMemo(() => ndrQuery(dc, dateStart, dateEnd), [dc, dateStart, dateEnd]);
  const ndrData = useMetricsQuery(["co-ndr", ndrSql], ndrSql);

  const seatSql = useMemo(
    () => seatUtilizationQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd]
  );
  const seatData = useMetricsQuery(["co-seat", seatSql], seatSql);

  // ── Self-Serve ───────────────────────────────────────────────────────
  const ssConvSql = useMemo(
    () => selfServeConversionQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd]
  );
  const ssConvData = useMetricsQuery(["co-ssconv", ssConvSql], ssConvSql);

  const ssRetSql = useMemo(
    () => selfServeRetentionQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd]
  );
  const ssRetData = useMetricsQuery(["co-ssret", ssRetSql], ssRetSql);

  const ssWauSql = useMemo(
    () => selfServeWauQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd]
  );
  const ssWauData = useMetricsQuery(["co-sswau", ssWauSql], ssWauSql);

  const ssArpaSql = useMemo(
    () => selfServeArpaQuery(dc, dateStart, dateEnd),
    [dc, dateStart, dateEnd]
  );
  const ssArpaData = useMetricsQuery(["co-ssarpa", ssArpaSql], ssArpaSql);

  // ── Latest headline values ───────────────────────────────────────────
  const qlsRows = qlsData.data?.rows ?? [];
  const s1sRows = s1sData.data?.rows ?? [];
  const s1sNamedRows = s1sNamedData.data?.rows ?? [];
  const acvRows = acvData.data?.rows ?? [];
  const povRows = povData.data?.rows ?? [];
  const aeRows = aeData.data?.rows ?? [];
  const expRows = expData.data?.rows ?? [];
  const ndrRows = ndrData.data?.rows ?? [];
  const seatRows = seatData.data?.rows ?? [];
  const ssConvRows = ssConvData.data?.rows ?? [];
  const ssRetRows = ssRetData.data?.rows ?? [];
  const ssWauRows = ssWauData.data?.rows ?? [];
  const ssArpaRows = ssArpaData.data?.rows ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Company KPIs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Focus areas and key metrics across all motions
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
                {(["Weekly", "Monthly", "Quarterly"] as const).map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">From</label>
            <DatePicker value={dateStart} onChange={setDateStart} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">To</label>
            <DatePicker value={dateEnd} onChange={setDateEnd} />
          </div>
        </div>
      </div>

      {/* ── Section 1: TOFU & Pipeline ────────────────────────────────── */}
      <SectionCard title="TOFU & Pipeline">
        <KpiChart
          title="QLs"
          subtitle="Qualified leads per period"
          rows={qlsRows}
          dataKey="qls"
          chartType="bar"
          color="#3b82f6"
          isLoading={qlsData.isLoading}
          error={qlsData.data?.error}
          latestValue={lastVal(qlsRows, "qls", formatNumber)}
        />
        <KpiChart
          title="S1s"
          subtitle="Contacts entering S1 stage"
          rows={s1sRows}
          dataKey="s1s"
          chartType="bar"
          color="#8b5cf6"
          isLoading={s1sData.isLoading}
          error={s1sData.data?.error}
          latestValue={lastVal(s1sRows, "s1s", formatNumber)}
        />
        <KpiChart
          title="S1s from Named Accounts"
          subtitle="Target account deals at S1+ stage"
          rows={s1sNamedRows}
          dataKey="s1s_named"
          chartType="bar"
          color="#06b6d4"
          isLoading={s1sNamedData.isLoading}
          error={s1sNamedData.data?.error}
          latestValue={lastVal(s1sNamedRows, "s1s_named", formatNumber)}
        />
      </SectionCard>

      {/* ── Section 2: Sales Productivity ─────────────────────────────── */}
      <SectionCard title="Sales Productivity">
        <KpiChart
          title="Landing ACV"
          subtitle="Average deal size (closed-won)"
          rows={acvRows}
          dataKey="avg_acv"
          chartType="line"
          color="#10b981"
          isLoading={acvData.isLoading}
          error={acvData.data?.error}
          yFormatter={(v) =>
            `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)}`
          }
          latestValue={lastVal(acvRows, "avg_acv", formatCurrency)}
        />
        <KpiChart
          title="POV Win Rate"
          subtitle="% of S2 POV deals that closed won"
          rows={povRows}
          dataKey="pov_win_rate"
          chartType="line"
          color="#f59e0b"
          isLoading={povData.isLoading}
          error={povData.data?.error}
          yFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          latestValue={lastNonZero(povRows, "pov_win_rate", formatPercent)}
        />
        <KpiChart
          title="Hired AE Capacity"
          subtitle="Distinct AEs active on deals"
          rows={aeRows}
          dataKey="ae_count"
          chartType="area"
          color="#ec4899"
          isLoading={aeData.isLoading}
          error={aeData.data?.error}
          latestValue={lastVal(aeRows, "ae_count", formatNumber)}
        />
      </SectionCard>

      {/* ── Section 3: Expansion ──────────────────────────────────────── */}
      <SectionCard title="Expansion">
        <KpiChart
          title="Enterprise ARR"
          subtitle="Total enterprise subscription ARR"
          rows={seatRows}
          dataKey="total_arr"
          chartType="area"
          color="#6366f1"
          isLoading={seatData.isLoading}
          error={seatData.data?.error}
          yFormatter={(v) => {
            if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
            if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
            return `$${v.toFixed(0)}`;
          }}
          latestValue={lastVal(seatRows, "total_arr", formatCurrency)}
        />
        <KpiChart
          title="Expansion Pipeline"
          subtitle="Open expansion deal value"
          rows={expRows}
          dataKey="expansion_pipeline"
          chartType="bar"
          color="#f97316"
          isLoading={expData.isLoading}
          error={expData.data?.error}
          yFormatter={(v) => {
            if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
            if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
            return `$${v.toFixed(0)}`;
          }}
          latestValue={lastVal(expRows, "expansion_pipeline", formatCurrency)}
        />
        <KpiChart
          title="90-day NDR"
          subtitle="Net dollar retention (enterprise)"
          rows={ndrRows}
          dataKey="ndr"
          chartType="line"
          color="#ef4444"
          isLoading={ndrData.isLoading}
          error={ndrData.data?.error}
          yFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          latestValue={lastNonZero(ndrRows, "ndr", formatPercent)}
        />
      </SectionCard>

      {/* ── Section 4: Self-Serve ─────────────────────────────────────── */}
      <SectionCard title="Self-Serve">
        <KpiChart
          title="Signup → Paid Conversion"
          subtitle="% of signups converting to paid"
          rows={ssConvRows}
          dataKey="conversion_rate"
          chartType="line"
          color="#10b981"
          isLoading={ssConvData.isLoading}
          error={ssConvData.data?.error}
          yFormatter={(v) => `${(v * 100).toFixed(1)}%`}
          latestValue={lastVal(ssConvRows, "conversion_rate", formatPercent)}
        />
        <KpiChart
          title="30-day Retention"
          subtitle="% of signups returning after first period"
          rows={ssRetRows}
          dataKey="retention_rate"
          chartType="line"
          color="#f59e0b"
          isLoading={ssRetData.isLoading}
          error={ssRetData.data?.error}
          yFormatter={(v) => `${(v * 100).toFixed(1)}%`}
          latestValue={lastNonZero(ssRetRows, "retention_rate", formatPercent)}
        />
        <KpiChart
          title="Weekly Active Users"
          subtitle={`${cadence} active users`}
          rows={ssWauRows}
          dataKey="active_users"
          chartType="area"
          color="#6366f1"
          isLoading={ssWauData.isLoading}
          error={ssWauData.data?.error}
          latestValue={lastVal(ssWauRows, "active_users", formatNumber)}
        />
        <KpiChart
          title="Average Revenue Per Account"
          subtitle="ARPA (self-serve)"
          rows={ssArpaRows}
          dataKey="arpa"
          chartType="area"
          color="#8b5cf6"
          isLoading={ssArpaData.isLoading}
          error={ssArpaData.data?.error}
          yFormatter={(v) =>
            `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`
          }
          latestValue={lastVal(ssArpaRows, "arpa", formatCurrency)}
        />
      </SectionCard>
    </div>
  );
}
