import { useState, useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { MultiSelect } from "./MultiSelect";
import { DateRangeInput } from "./DateRangeInput";
import { ViewByControls } from "./ViewByControls";
import { PagePerformanceTable } from "./PagePerformanceTable";
import { TextFilter } from "./TextFilter";
import { useFilterOptions } from "../hooks";
import { chartQuery, pagePerformanceQuery } from "../queries";
import type { DateCadence, ViewByOption } from "../types";
import { getYesterday, formatPercent, formatNumber } from "../types";
import { useUrlFilterState } from "../useUrlFilterState";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { InlineMetric } from "@/components/InlineMetric";

const FILTER_DEFS = {
  dateStart: { type: "string" as const, default: "2026-01-01" },
  dateEnd: { type: "string" as const, default: getYesterday() },
  pageType: { type: "string[]" as const, default: [] as string[] },
  channel: { type: "string[]" as const, default: [] as string[] },
  referrer: { type: "string[]" as const, default: [] as string[] },
  urlFilter: { type: "string" as const, default: "" },
  subPageType: { type: "string[]" as const, default: [] as string[] },
  author: { type: "string[]" as const, default: [] as string[] },
  cadence: { type: "string" as const, default: "Weekly" },
  viewBy: { type: "string" as const, default: "Page Sub Type" },
  blogOnly: { type: "string" as const, default: "" },
  explainerOnly: { type: "string" as const, default: "" },
  sortCol: { type: "string" as const, default: "signups" },
  sortDir: { type: "string" as const, default: "desc" },
};

export function FirstTouchTraffic() {
  const [f, setF] = useUrlFilterState(FILTER_DEFS, "t1");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const cadence = f.cadence as DateCadence;
  const viewBy = f.viewBy as ViewByOption;
  const blogOnly = f.blogOnly === "true";
  const explainerOnly = f.explainerOnly === "true";
  const tableSort = { col: f.sortCol, dir: f.sortDir as "asc" | "desc" };

  const pageTypeOpts = useFilterOptions("page_type", "pageviews", f.dateStart, f.dateEnd);
  const channelOpts = useFilterOptions("first_touch_channel", "pageviews", f.dateStart, f.dateEnd);
  const referrerOpts = useFilterOptions("c_referrer", "pageviews", f.dateStart, f.dateEnd);
  const subPageTypeOpts = useFilterOptions("sub_page_type", "pageviews", f.dateStart, f.dateEnd);
  const authorOpts = useFilterOptions("author", "bpc_author");

  const filters = useMemo(() => ({
    dateStart: f.dateStart, dateEnd: f.dateEnd, pageType: f.pageType,
    channel: f.channel, referrer: f.referrer, baseUrl: [] as string[], subPageType: f.subPageType,
    urlFilter: f.urlFilter, author: f.author,
  }), [f.dateStart, f.dateEnd, f.pageType, f.channel, f.referrer, f.subPageType, f.urlFilter, f.author]);

  const chartSql = useMemo(() => chartQuery(cadence, viewBy, filters), [cadence, viewBy, filters]);

  const tableFilters = useMemo(() => {
    if (blogOnly) return { ...filters, pageType: ["blog"] };
    if (explainerOnly) return { ...filters, pageType: ["explainer"] };
    return filters;
  }, [filters, blogOnly, explainerOnly]);

  const tableSql = useMemo(() => pagePerformanceQuery(tableFilters, false, tableSort), [tableFilters, tableSort]);

  const chartData = useMetricsQuery(["ft-chart", chartSql], chartSql);
  const tableData = useMetricsQuery(["ft-table", tableSql], tableSql);

  const handleTableSort = (col: string, dir: "asc" | "desc") => {
    setF("sortCol", col);
    setF("sortDir", dir);
  };

  const activeFilterCount = [f.pageType, f.channel, f.referrer, f.subPageType].filter(a => a.length > 0).length
    + (f.urlFilter ? 1 : 0);
  // author is shown in top row, not counted as hidden filter

  const kpiTotals = useMemo(() => {
    const rows = chartData.data?.rows ?? [];
    let totalVisitors = 0;
    let totalSignups = 0;
    for (const r of rows) {
      totalVisitors += Number(r.new_visitors ?? 0);
      totalSignups += Number(r.signups ?? 0);
    }
    return {
      visitors: totalVisitors,
      signups: totalSignups,
      signupRate: totalVisitors > 0 ? totalSignups / totalVisitors : 0,
    };
  }, [chartData.data]);

  return (
    <div className="space-y-3">
      {/* Unified Filters — date always visible, rest collapsible */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex flex-wrap gap-3 items-end">
          <DateRangeInput
            label="First Pageview Date"
            startDate={f.dateStart}
            endDate={f.dateEnd}
            onStartChange={(v) => setF("dateStart", v)}
            onEndChange={(v) => setF("dateEnd", v)}
          />
          <ViewByControls
            cadence={cadence}
            onCadenceChange={(v) => setF("cadence", v)}
            viewBy={viewBy}
            onViewByChange={(v) => setF("viewBy", v)}
          />
          <MultiSelect label="Author" options={authorOpts.options} value={f.author} onChange={(v) => setF("author", v)} isLoading={authorOpts.isLoading} />
          <button
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            className="flex items-center gap-1 h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {filtersExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            More filters{activeFilterCount > 0 && <span className="ml-1 text-[10px] bg-primary/20 text-primary rounded px-1">{activeFilterCount}</span>}
          </button>
        </div>

        {filtersExpanded && (
          <div className="pt-2 border-t border-border/50 space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <MultiSelect label="Page Type" options={pageTypeOpts.options} value={f.pageType} onChange={(v) => setF("pageType", v)} isLoading={pageTypeOpts.isLoading} />
              <MultiSelect label="Channel" options={channelOpts.options} value={f.channel} onChange={(v) => setF("channel", v)} isLoading={channelOpts.isLoading} />
              <MultiSelect label="Referrer" options={referrerOpts.options} value={f.referrer} onChange={(v) => setF("referrer", v)} isLoading={referrerOpts.isLoading} />
              <MultiSelect label="Sub Page Type" options={subPageTypeOpts.options} value={f.subPageType} onChange={(v) => setF("subPageType", v)} isLoading={subPageTypeOpts.isLoading} />
              <TextFilter label="Base URL Contains" value={f.urlFilter} onChange={(v) => setF("urlFilter", v)} placeholder="e.g. /blog/headless-cms" />
            </div>
            <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
              <Info className="h-3 w-3 flex-shrink-0" />
              Pageview centric — cohorted to first pageview date. Signups without a tracked pageview (adblock/figma) are excluded.
            </p>
          </div>
        )}
      </div>

      {/* Page Performance Table */}
      <PagePerformanceTable
        rows={tableData.data?.rows ?? []}
        isLoading={tableData.isLoading}
        error={tableData.data?.error}
        variant="tab1"
        sortCol={tableSort.col}
        sortDir={tableSort.dir}
        onSortChange={handleTableSort}
        blogOnly={blogOnly}
        onBlogOnlyChange={(v) => { setF("blogOnly", v ? "true" : ""); if (v) setF("explainerOnly", ""); }}
        explainerOnly={explainerOnly}
        onExplainerOnlyChange={(v) => { setF("explainerOnly", v ? "true" : ""); if (v) setF("blogOnly", ""); }}
      />
    </div>
  );
}
