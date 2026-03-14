import { useState, useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { MultiSelect } from "./MultiSelect";
import { DateRangeInput } from "./DateRangeInput";
import { ViewByControls } from "./ViewByControls";
import { DynamicChart } from "./DynamicChart";
import { useFilterOptions } from "../hooks";
import { signupCentricChartQuery } from "../queries";
import type { DateCadence, ViewByOption } from "../types";
import { getToday, formatPercent } from "../types";
import { useUrlFilterState } from "../useUrlFilterState";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

const FILTER_DEFS = {
  dateStart: { type: "string" as const, default: "2026-01-01" },
  dateEnd: { type: "string" as const, default: getToday() },
  coalesceChannel: { type: "string[]" as const, default: [] as string[] },
  pageType: { type: "string[]" as const, default: [] as string[] },
  referrer: { type: "string[]" as const, default: [] as string[] },
  icpFlag: { type: "string[]" as const, default: [] as string[] },
  paidSubFlag: { type: "string[]" as const, default: [] as string[] },
  subscriptionAfterSignup: { type: "string[]" as const, default: [] as string[] },
  spaceKind: { type: "string[]" as const, default: [] as string[] },
  urlContainsFigma: { type: "string[]" as const, default: [] as string[] },
  cadence: { type: "string" as const, default: "Weekly" },
  viewBy: { type: "string" as const, default: "Channel" },
};

export function SignupsByChannel() {
  const [f, setF] = useUrlFilterState(FILTER_DEFS, "t2");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const cadence = f.cadence as DateCadence;
  const viewBy = f.viewBy as ViewByOption;

  const channelOpts = useFilterOptions("channel", "signups", f.dateStart, f.dateEnd);
  const pageTypeOpts = useFilterOptions("page_type", "pageviews", f.dateStart, f.dateEnd);
  const referrerOpts = useFilterOptions("referrer", "signups", f.dateStart, f.dateEnd);

  const filters = useMemo(() => ({
    dateStart: f.dateStart,
    dateEnd: f.dateEnd,
    coalesceChannel: f.coalesceChannel,
    pageType: f.pageType,
    referrer: f.referrer,
    icpFlag: f.icpFlag,
    paidSubFlag: f.paidSubFlag,
    subscriptionAfterSignup: f.subscriptionAfterSignup,
    spaceKind: f.spaceKind,
    urlContainsFigma: f.urlContainsFigma,
  }), [f.dateStart, f.dateEnd, f.coalesceChannel, f.pageType, f.referrer, f.icpFlag, f.paidSubFlag, f.subscriptionAfterSignup, f.spaceKind, f.urlContainsFigma]);

  const chartSql = useMemo(
    () => signupCentricChartQuery(cadence, viewBy, filters),
    [cadence, viewBy, filters]
  );

  const chartData = useMetricsQuery(["sc-chart", chartSql], chartSql);

  const activeFilterCount = [f.coalesceChannel, f.pageType, f.referrer, f.icpFlag, f.paidSubFlag, f.subscriptionAfterSignup, f.urlContainsFigma].filter(a => a.length > 0).length;

  return (
    <div className="space-y-3">
      {/* Unified Filters */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex flex-wrap gap-3 items-end">
          <DateRangeInput label="User Create Date" startDate={f.dateStart} endDate={f.dateEnd} onStartChange={(v) => setF("dateStart", v)} onEndChange={(v) => setF("dateEnd", v)} />
          <ViewByControls cadence={cadence} onCadenceChange={(v) => setF("cadence", v)} viewBy={viewBy} onViewByChange={(v) => setF("viewBy", v)} />
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
              <MultiSelect label="Channel" options={channelOpts.options} value={f.coalesceChannel} onChange={(v) => setF("coalesceChannel", v)} isLoading={channelOpts.isLoading} />
              <MultiSelect label="Page Type" options={pageTypeOpts.options} value={f.pageType} onChange={(v) => setF("pageType", v)} isLoading={pageTypeOpts.isLoading} />
              <MultiSelect label="Referrer" options={referrerOpts.options} value={f.referrer} onChange={(v) => setF("referrer", v)} isLoading={referrerOpts.isLoading} />
              <MultiSelect label="ICP Flag" options={["True", "False"]} value={f.icpFlag} onChange={(v) => setF("icpFlag", v)} />
              <MultiSelect label="Paid Sub Flag" options={["True", "False"]} value={f.paidSubFlag} onChange={(v) => setF("paidSubFlag", v)} />
              <MultiSelect label="Sub After Signup" options={["True", "False", "null"]} value={f.subscriptionAfterSignup} onChange={(v) => setF("subscriptionAfterSignup", v)} />
              <MultiSelect label="URL Contains Figma" options={["True", "False"]} value={f.urlContainsFigma} onChange={(v) => setF("urlContainsFigma", v)} />
            </div>
            <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
              <Info className="h-3 w-3 flex-shrink-0" />
              Signup-centric — includes ALL product signups, even those without tracked pageviews.
            </p>
          </div>
        )}
      </div>

      {/* Row 1: Signups, Conversion */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DynamicChart
          title="Signups by Dynamic Selection"
          rows={chartData.data?.rows ?? []}
          valueKey="signups"
          chartType="stacked-bar"
          isLoading={chartData.isLoading}
          error={chartData.data?.error}
        />
        <DynamicChart
          title="Signup to Paid Sub Conversion"
          rows={chartData.data?.rows ?? []}
          valueKey="signup_to_paid_conversion"
          chartType="line"
          isLoading={chartData.isLoading}
          error={chartData.data?.error}
          yFormatter={formatPercent}
        />
      </div>

      {/* Row 2: Deals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DynamicChart
          title="All Deals (S0s) by Dynamic Selection"
          rows={chartData.data?.rows ?? []}
          valueKey="all_deals_s0"
          chartType="stacked-bar"
          isLoading={chartData.isLoading}
          error={chartData.data?.error}
        />
        <DynamicChart
          title="Qualified Deals (S1s) by Dynamic Selection"
          rows={chartData.data?.rows ?? []}
          valueKey="qualified_deals_s1"
          chartType="stacked-bar"
          isLoading={chartData.isLoading}
          error={chartData.data?.error}
        />
      </div>
    </div>
  );
}
