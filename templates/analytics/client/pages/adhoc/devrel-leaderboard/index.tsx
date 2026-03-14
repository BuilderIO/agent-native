import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { useBlogSeoData } from "@/lib/api-hooks";
import { useUrlFilterState } from "../top-funnel/useUrlFilterState";
import { DateRangeInput } from "../top-funnel/components/DateRangeInput";
import { DatePicker } from "@/components/ui/date-picker";
import { DynamicChart } from "../top-funnel/components/DynamicChart";
import { AuthorCards } from "./AuthorCards";
import { ArticleTable } from "./ArticleTable";
import {
  authorSummaryQuery,
  articleDetailQuery,
  authorTimeseriesQuery,
} from "./queries";
import { TwitterSection } from "./TwitterSection";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const RECENCY_PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 14 days", days: 14 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

const FILTER_DEFS = {
  dateStart: { type: "string" as const, default: "2026-01-01" },
  dateEnd: { type: "string" as const, default: daysAgo(0) },
  pubDateStart: { type: "string" as const, default: "" },
  metric: { type: "string" as const, default: "signups" },
  cadence: { type: "string" as const, default: "WEEK" },
};

export default function DevRelLeaderboard() {
  const [f, setF, setMany] = useUrlFilterState(FILTER_DEFS, "dr");

  const metric = f.metric as "signups" | "new_visitors";
  const cadence = f.cadence as "WEEK" | "MONTH";

  // SEO data from DataForSEO
  const seo = useBlogSeoData();
  const seoPages = seo.data?.pages;

  // Author summary cards
  const summarySql = useMemo(
    () => authorSummaryQuery(f.dateStart, f.dateEnd, f.pubDateStart),
    [f.dateStart, f.dateEnd, f.pubDateStart]
  );
  const summary = useMetricsQuery(["devrel-summary", summarySql], summarySql);

  // Article detail table
  const detailSql = useMemo(
    () => articleDetailQuery(f.dateStart, f.dateEnd, f.pubDateStart),
    [f.dateStart, f.dateEnd, f.pubDateStart]
  );
  const detail = useMetricsQuery(["devrel-detail", detailSql], detailSql);

  // Timeseries chart
  const tsSql = useMemo(
    () =>
      authorTimeseriesQuery(
        f.dateStart,
        f.dateEnd,
        f.pubDateStart,
        metric,
        cadence
      ),
    [f.dateStart, f.dateEnd, f.pubDateStart, metric, cadence]
  );
  const timeseries = useMetricsQuery(["devrel-ts", tsSql], tsSql);

  // Aggregate SEO metrics per author from article rows + seo data
  const authorSeoTotals = useMemo(() => {
    if (!seoPages || !detail.data?.rows) return {};
    const totals: Record<string, { etv: number; keywords: number }> = {};
    for (const row of detail.data.rows) {
      const author = String(row.author ?? "");
      const handle = String(row.handle ?? "");
      const seoInfo = seoPages[handle];
      if (!author || !seoInfo) continue;
      if (!totals[author]) totals[author] = { etv: 0, keywords: 0 };
      totals[author].etv += seoInfo.etv;
      totals[author].keywords += seoInfo.ranked_keywords;
    }
    return totals;
  }, [seoPages, detail.data]);

  const recentActive = !!f.pubDateStart;

  const toggleRecent = () => {
    if (recentActive) {
      setF("pubDateStart", "");
    } else {
      setF("pubDateStart", daysAgo(30));
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Filters
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <DateRangeInput
            label="Traffic Date Range"
            startDate={f.dateStart}
            endDate={f.dateEnd}
            onStartChange={(v) => setF("dateStart", v)}
            onEndChange={(v) => setF("dateEnd", v)}
          />

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Recent Articles Only
            </label>
            <Button
              variant={recentActive ? "default" : "outline"}
              size="sm"
              className="text-xs h-8 px-3"
              onClick={toggleRecent}
            >
              {recentActive ? "On" : "Off"}
            </Button>
          </div>

          {recentActive && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">
                  Published After
                </label>
                <DatePicker value={f.pubDateStart} onChange={(v) => setF("pubDateStart", v)} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Author Leaderboard Cards */}
      <div className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-semibold mb-2">Author Leaderboard</h2>
        <AuthorCards
          rows={summary.data?.rows ?? []}
          isLoading={summary.isLoading}
          error={summary.data?.error}
          seoTotals={authorSeoTotals}
        />
      </div>

      {/* Timeseries */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={metric} onValueChange={(v) => setF("metric", v)}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="signups" className="text-xs">
              Signups
            </SelectItem>
            <SelectItem value="new_visitors" className="text-xs">
              Traffic
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={cadence} onValueChange={(v) => setF("cadence", v)}>
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="WEEK" className="text-xs">
              Weekly
            </SelectItem>
            <SelectItem value="MONTH" className="text-xs">
              Monthly
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DynamicChart
        title={`${metric === "signups" ? "Signups" : "Traffic"} by Author`}
        rows={timeseries.data?.rows ?? []}
        valueKey="value"
        chartType="stacked-area"
        isLoading={timeseries.isLoading}
        error={timeseries.data?.error}
      />

      {/* Article Table with SEO data */}
      <ArticleTable
        rows={detail.data?.rows ?? []}
        seoData={seoPages}
        isLoading={detail.isLoading}
        seoLoading={seo.isLoading}
        error={detail.data?.error}
      />

      {/* Twitter Engagement */}
      <TwitterSection days={30} />
    </div>
  );
}
