import { useState, useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { MultiSelect } from "./MultiSelect";
import { DateRangeInput } from "./DateRangeInput";
import { SingleDateInput } from "./DateRangeInput";
import { ViewByControls } from "./ViewByControls";
import { DynamicChart } from "./DynamicChart";
import { PagePerformanceTable } from "./PagePerformanceTable";
import { TextFilter } from "./TextFilter";
import { useFilterOptions } from "../hooks";
import {
  chartQuery,
  qlsQuery,
  pipelineQuery,
  ssArrQuery,
  pagePerformanceQuery,
} from "../queries";
import type { DateCadence, ViewByOption } from "../types";
import { getYesterday, formatPercent, formatCurrency } from "../types";
import { useUrlFilterState } from "../useUrlFilterState";
import { ChevronDown, ChevronRight } from "lucide-react";

const FILTER_DEFS = {
  dateStart: { type: "string" as const, default: "2026-01-01" },
  dateEnd: { type: "string" as const, default: getYesterday() },
  pageType: { type: "string[]" as const, default: ["blog"] },
  subPageType: { type: "string[]" as const, default: ["blog"] },
  baseUrl: { type: "string[]" as const, default: [] as string[] },
  channel: { type: "string[]" as const, default: [] as string[] },
  referrer: { type: "string[]" as const, default: [] as string[] },
  utmMedium: { type: "string[]" as const, default: [] as string[] },
  utmSource: { type: "string[]" as const, default: [] as string[] },
  utmTerm: { type: "string[]" as const, default: [] as string[] },
  utmCampaign: { type: "string[]" as const, default: [] as string[] },
  utmContent: { type: "string[]" as const, default: [] as string[] },
  author: { type: "string[]" as const, default: [] as string[] },
  type: { type: "string[]" as const, default: [] as string[] },
  subType: { type: "string[]" as const, default: [] as string[] },
  purpose: { type: "string[]" as const, default: [] as string[] },
  persona: { type: "string[]" as const, default: [] as string[] },
  pubDateStart: { type: "string" as const, default: "2026-01-01" },
  urlFilter: { type: "string" as const, default: "" },
  cadence: { type: "string" as const, default: "Weekly" },
  viewBy: { type: "string" as const, default: "Blog Author" },
  blogOnly: { type: "string" as const, default: "" },
  explainerOnly: { type: "string" as const, default: "" },
  sortCol: { type: "string" as const, default: "signups" },
  sortDir: { type: "string" as const, default: "desc" },
};

export function PagePerformanceTab() {
  const [f, setF] = useUrlFilterState(FILTER_DEFS, "t3");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const cadence = f.cadence as DateCadence;
  const viewBy = f.viewBy as ViewByOption;
  const blogOnly = f.blogOnly === "true";
  const explainerOnly = f.explainerOnly === "true";
  const tableSort = { col: f.sortCol, dir: f.sortDir as "asc" | "desc" };

  // Filter options from BigQuery
  const pageTypeOpts = useFilterOptions(
    "page_type",
    "pageviews",
    f.dateStart,
    f.dateEnd,
  );
  const subPageTypeOpts = useFilterOptions(
    "sub_page_type",
    "pageviews",
    f.dateStart,
    f.dateEnd,
  );
  const channelOpts = useFilterOptions(
    "first_touch_channel",
    "pageviews",
    f.dateStart,
    f.dateEnd,
  );
  const referrerOpts = useFilterOptions(
    "c_referrer",
    "pageviews",
    f.dateStart,
    f.dateEnd,
  );
  const authorOpts = useFilterOptions("author", "bpc_author");
  const typeOpts = useFilterOptions("topic", "bpc");
  const subTypeOpts = useFilterOptions("sub_type", "bpc");
  const purposeOpts = useFilterOptions("purpose", "bpc");
  const personaOpts = useFilterOptions("persona", "bpc");
  const utmMediumOpts = useFilterOptions(
    "utm_medium",
    "pageviews",
    f.dateStart,
    f.dateEnd,
  );
  const utmSourceOpts = useFilterOptions(
    "utm_source",
    "pageviews",
    f.dateStart,
    f.dateEnd,
  );
  const utmCampaignOpts = useFilterOptions(
    "utm_campaign",
    "pageviews",
    f.dateStart,
    f.dateEnd,
  );

  const filters = useMemo(
    () => ({
      dateStart: f.dateStart,
      dateEnd: f.dateEnd,
      pageType: f.pageType,
      channel: f.channel,
      referrer: f.referrer,
      baseUrl: f.urlFilter ? [...f.baseUrl, f.urlFilter] : f.baseUrl,
      subPageType: f.subPageType,
      utmMedium: f.utmMedium,
      utmSource: f.utmSource,
      utmTerm: f.utmTerm,
      utmCampaign: f.utmCampaign,
      utmContent: f.utmContent,
      author: f.author,
      type: f.type,
      subType: f.subType,
      purpose: f.purpose,
      persona: f.persona,
      pubDateStart: f.pubDateStart,
    }),
    [
      f.dateStart,
      f.dateEnd,
      f.pageType,
      f.channel,
      f.referrer,
      f.baseUrl,
      f.subPageType,
      f.utmMedium,
      f.utmSource,
      f.utmTerm,
      f.utmCampaign,
      f.utmContent,
      f.author,
      f.type,
      f.subType,
      f.purpose,
      f.persona,
      f.pubDateStart,
      f.urlFilter,
    ],
  );

  const chartSql = useMemo(
    () => chartQuery(cadence, viewBy, filters, true),
    [cadence, viewBy, filters],
  );
  const qlsSql = useMemo(
    () => qlsQuery(cadence, viewBy, filters, true),
    [cadence, viewBy, filters],
  );
  const pipeSql = useMemo(
    () => pipelineQuery(cadence, viewBy, filters, true),
    [cadence, viewBy, filters],
  );
  const arrSql = useMemo(
    () => ssArrQuery(cadence, viewBy, filters, true),
    [cadence, viewBy, filters],
  );

  const tableFilters = useMemo(() => {
    if (blogOnly) return { ...filters, pageType: ["blog"] };
    if (explainerOnly) return { ...filters, pageType: ["explainer"] };
    return filters;
  }, [filters, blogOnly, explainerOnly]);

  const tableSql = useMemo(
    () => pagePerformanceQuery(tableFilters, true, tableSort),
    [tableFilters, tableSort],
  );

  const chartData = useMetricsQuery(["pp-chart", chartSql], chartSql);
  const qlsData = useMetricsQuery(["pp-qls", qlsSql], qlsSql);
  const pipeData = useMetricsQuery(["pp-pipe", pipeSql], pipeSql);
  const arrData = useMetricsQuery(["pp-arr", arrSql], arrSql);
  const tableData = useMetricsQuery(["pp-table", tableSql], tableSql);

  const handleTableSort = (col: string, dir: "asc" | "desc") => {
    setF("sortCol", col);
    setF("sortDir", dir);
  };

  const activeFilterCount =
    [
      f.channel,
      f.referrer,
      f.author,
      f.type,
      f.subType,
      f.purpose,
      f.persona,
      f.utmMedium,
      f.utmSource,
      f.utmCampaign,
    ].filter((a) => a.length > 0).length + (f.urlFilter ? 1 : 0);

  return (
    <div className="space-y-3">
      {/* Unified Filters */}
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
          <button
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            className="flex items-center gap-1 h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {filtersExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            More filters
            {activeFilterCount > 0 && (
              <span className="ml-1 text-[10px] bg-primary/20 text-primary rounded px-1">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {filtersExpanded && (
          <div className="pt-2 border-t border-border/50 space-y-3">
            {/* Core filters */}
            <div className="flex flex-wrap gap-3 items-end">
              <MultiSelect
                label="Page Type"
                options={pageTypeOpts.options}
                value={f.pageType}
                onChange={(v) => setF("pageType", v)}
                isLoading={pageTypeOpts.isLoading}
              />
              <MultiSelect
                label="Sub Page Type"
                options={subPageTypeOpts.options}
                value={f.subPageType}
                onChange={(v) => setF("subPageType", v)}
                isLoading={subPageTypeOpts.isLoading}
              />
              <MultiSelect
                label="Channel"
                options={channelOpts.options}
                value={f.channel}
                onChange={(v) => setF("channel", v)}
                isLoading={channelOpts.isLoading}
              />
              <MultiSelect
                label="Referrer"
                options={referrerOpts.options}
                value={f.referrer}
                onChange={(v) => setF("referrer", v)}
                isLoading={referrerOpts.isLoading}
              />
            </div>

            {/* Blog metadata filters */}
            <div className="flex flex-wrap gap-3 items-end">
              <MultiSelect
                label="Author"
                options={authorOpts.options}
                value={f.author}
                onChange={(v) => setF("author", v)}
                isLoading={authorOpts.isLoading}
              />
              <MultiSelect
                label="Type"
                options={typeOpts.options}
                value={f.type}
                onChange={(v) => setF("type", v)}
                isLoading={typeOpts.isLoading}
              />
              <MultiSelect
                label="Sub Type"
                options={subTypeOpts.options}
                value={f.subType}
                onChange={(v) => setF("subType", v)}
                isLoading={subTypeOpts.isLoading}
              />
              <MultiSelect
                label="Purpose"
                options={purposeOpts.options}
                value={f.purpose}
                onChange={(v) => setF("purpose", v)}
                isLoading={purposeOpts.isLoading}
              />
              <MultiSelect
                label="Persona"
                options={personaOpts.options}
                value={f.persona}
                onChange={(v) => setF("persona", v)}
                isLoading={personaOpts.isLoading}
              />
              <SingleDateInput
                label="Pub Date (on or after)"
                value={f.pubDateStart}
                onChange={(v) => setF("pubDateStart", v)}
              />
            </div>

            {/* UTM filters */}
            <div className="flex flex-wrap gap-3 items-end">
              <MultiSelect
                label="UTM Medium"
                options={utmMediumOpts.options}
                value={f.utmMedium}
                onChange={(v) => setF("utmMedium", v)}
                isLoading={utmMediumOpts.isLoading}
              />
              <MultiSelect
                label="UTM Source"
                options={utmSourceOpts.options}
                value={f.utmSource}
                onChange={(v) => setF("utmSource", v)}
                isLoading={utmSourceOpts.isLoading}
              />
              <MultiSelect
                label="UTM Campaign"
                options={utmCampaignOpts.options}
                value={f.utmCampaign}
                onChange={(v) => setF("utmCampaign", v)}
                isLoading={utmCampaignOpts.isLoading}
              />
              <TextFilter
                label="URL Contains"
                value={f.urlFilter}
                onChange={(v) => setF("urlFilter", v)}
                placeholder="e.g. figma-to-angular"
              />
            </div>
          </div>
        )}
      </div>

      {/* Page Performance Table */}
      <PagePerformanceTable
        rows={tableData.data?.rows ?? []}
        isLoading={tableData.isLoading}
        error={tableData.data?.error}
        variant="tab3"
        sortCol={tableSort.col}
        sortDir={tableSort.dir}
        onSortChange={handleTableSort}
        blogOnly={blogOnly}
        onBlogOnlyChange={(v) => {
          setF("blogOnly", v ? "true" : "");
          if (v) setF("explainerOnly", "");
        }}
        explainerOnly={explainerOnly}
        onExplainerOnlyChange={(v) => {
          setF("explainerOnly", v ? "true" : "");
          if (v) setF("blogOnly", "");
        }}
      />

      {/* Row 1: Visitors, Signups, Signup Rate */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DynamicChart
          title="New Visitors by Dynamic Selection"
          rows={chartData.data?.rows ?? []}
          valueKey="new_visitors"
          chartType="line"
          isLoading={chartData.isLoading}
          error={chartData.data?.error}
        />
        <DynamicChart
          title="Signups by Dynamic Selection"
          rows={chartData.data?.rows ?? []}
          valueKey="signups"
          chartType="line"
          isLoading={chartData.isLoading}
          error={chartData.data?.error}
        />
        <DynamicChart
          title="Signup Rate by Dynamic Selection"
          rows={chartData.data?.rows ?? []}
          valueKey="signup_rate"
          chartType="line"
          isLoading={chartData.isLoading}
          error={chartData.data?.error}
          yFormatter={formatPercent}
        />
      </div>

      {/* Row 2: QLs, Pipeline, SS ARR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DynamicChart
          title="QLs by Dynamic Selection"
          rows={qlsData.data?.rows ?? []}
          valueKey="ql_count"
          chartType="stacked-bar"
          isLoading={qlsData.isLoading}
          error={qlsData.data?.error}
        />
        <DynamicChart
          title="Pipeline"
          rows={pipeData.data?.rows ?? []}
          valueKey="pipeline_amount"
          chartType="stacked-bar"
          isLoading={pipeData.isLoading}
          error={pipeData.data?.error}
          yFormatter={formatCurrency}
        />
        <DynamicChart
          title="SS ARR"
          rows={arrData.data?.rows ?? []}
          valueKey="ss_arr"
          chartType="stacked-bar"
          isLoading={arrData.isLoading}
          error={arrData.data?.error}
          yFormatter={formatCurrency}
        />
      </div>
    </div>
  );
}
