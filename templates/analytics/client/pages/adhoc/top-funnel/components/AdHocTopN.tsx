import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DynamicChart } from "./DynamicChart";
import { DateRangeInput } from "./DateRangeInput";
import { topNQuery } from "../queries";
import type { DateCadence } from "../types";
import { getToday, formatNumber } from "../types";
import { useUrlFilterState } from "../useUrlFilterState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FILTER_DEFS = {
  topN: { type: "number" as const, default: 10 },
  pageType: { type: "string" as const, default: "blog" },
  dateStart: { type: "string" as const, default: "2026-01-01" },
  dateEnd: { type: "string" as const, default: getToday() },
  cadence: { type: "string" as const, default: "Weekly" },
};

export function AdHocTopN() {
  const [f, setF] = useUrlFilterState(FILTER_DEFS, "t6");

  const cadence = f.cadence as DateCadence;

  const sql = useMemo(
    () => topNQuery(f.topN, f.pageType, f.dateStart, f.dateEnd, cadence),
    [f.topN, f.pageType, f.dateStart, f.dateEnd, cadence]
  );

  const { data, isLoading } = useMetricsQuery(["topn", sql], sql);

  // Get the unique base_urls to show in the summary table
  const topPages = useMemo(() => {
    const rows = data?.rows ?? [];
    const map = new Map<string, { base_url: string; page_type: string; traffic: number; signups: number }>();
    for (const r of rows) {
      const url = String(r.base_url ?? "");
      const existing = map.get(url);
      if (existing) {
        existing.traffic += Number(r.traffic ?? 0);
        existing.signups += Number(r.signups ?? 0);
      } else {
        map.set(url, {
          base_url: url,
          page_type: String(r.page_type ?? ""),
          traffic: Number(r.traffic ?? 0),
          signups: Number(r.signups ?? 0),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.signups - a.signups);
  }, [data]);

  // Pivot for charts: use base_url as the series key
  const chartRows = useMemo(() => {
    return (data?.rows ?? []).map((r) => ({
      flex_date: String(r.flex_date ?? ""),
      flex_view_by: String(r.base_url ?? ""),
      traffic: Number(r.traffic ?? 0),
      signups: Number(r.signups ?? 0),
    }));
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-lg border border-border p-3 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filters</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Top N</label>
            <Select value={String(f.topN)} onValueChange={(v) => setF("topN", Number(v))}>
              <SelectTrigger className="h-8 w-[80px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 15, 20, 25, 50].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Page Type</label>
            <Select value={f.pageType} onValueChange={(v) => setF("pageType", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blog" className="text-xs">blog</SelectItem>
                <SelectItem value="docs" className="text-xs">docs</SelectItem>
                <SelectItem value="marketing" className="text-xs">marketing</SelectItem>
                <SelectItem value="explainer" className="text-xs">explainer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DateRangeInput label="Date Range" startDate={f.dateStart} endDate={f.dateEnd} onStartChange={(v) => setF("dateStart", v)} onEndChange={(v) => setF("dateEnd", v)} />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Cadence</label>
            <Select value={f.cadence} onValueChange={(v) => setF("cadence", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Daily", "Weekly", "Monthly", "Quarterly"].map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Top N Table */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Top {f.topN} Pages by Signups</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : data?.error ? (
            <p className="text-sm text-red-400 py-4 text-center">{data.error}</p>
          ) : topPages.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No data</p>
          ) : (
            <div className="overflow-auto max-h-[300px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Base URL</th>
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Page Type</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Traffic</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Signups</th>
                  </tr>
                </thead>
                <tbody>
                  {topPages.map((row, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-1.5 px-2 font-mono text-[11px] max-w-[300px] truncate">{row.base_url}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{row.page_type}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{formatNumber(row.traffic)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{formatNumber(row.signups)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DynamicChart
          title={`Traffic by Top ${f.topN} Base URL`}
          rows={chartRows}
          valueKey="traffic"
          chartType="stacked-bar"
          isLoading={isLoading}
          error={data?.error}
        />
        <DynamicChart
          title={`Signups by Top ${f.topN} Base URL`}
          rows={chartRows}
          valueKey="signups"
          chartType="stacked-bar"
          isLoading={isLoading}
          error={data?.error}
        />
      </div>
    </div>
  );
}
