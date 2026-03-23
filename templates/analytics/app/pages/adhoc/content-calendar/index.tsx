import { useMemo, useState } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import {
  useContentCalendar,
  useBlogSeoData,
  useTopBlogKeywords,
} from "@/lib/api-hooks";
import { useUrlFilterState } from "../_shared/useUrlFilterState";
import { DateRangeInput } from "../_shared/components/DateRangeInput";
import { CalendarTable } from "./CalendarTable";
import { SeoRankingsTab } from "./SeoRankingsTab";
import { StrikingDistanceTab } from "./StrikingDistanceTab";
import { blogHandleMetricsQuery } from "./queries";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const FILTER_DEFS = {
  dateStart: { type: "string" as const, default: daysAgo(90) },
  dateEnd: { type: "string" as const, default: daysAgo(0) },
  sdExclude: { type: "string[]" as const, default: ["how i use"] },
};

type Tab = "calendar" | "seo" | "striking";
type ViewMode = "published" | "all" | "drafts";

export default function ContentCalendar() {
  const [f, setF] = useUrlFilterState(FILTER_DEFS, "cc");
  const [tab, setTab] = useState<Tab>("calendar");
  const [viewMode, setViewMode] = useState<ViewMode>("published");

  // Notion content calendar
  const calendar = useContentCalendar();
  const allEntries = calendar.data?.entries ?? [];
  const notionError = calendar.error as Error | null;

  // Filter entries based on view mode (calendar tab only)
  const entries = useMemo(() => {
    switch (viewMode) {
      case "published":
        return allEntries.filter((e) => e.handle);
      case "drafts":
        return allEntries.filter((e) => !e.handle);
      default:
        return allEntries;
    }
  }, [allEntries, viewMode]);

  // BigQuery analytics per blog handle
  const metricsSql = useMemo(
    () => blogHandleMetricsQuery(f.dateStart, f.dateEnd),
    [f.dateStart, f.dateEnd],
  );
  const metrics = useMetricsQuery(["cc-metrics", metricsSql], metricsSql);

  // SEO data (page-level for calendar tab)
  const seo = useBlogSeoData();

  // SEO keyword rankings (for SEO tab)
  const topKeywords = useTopBlogKeywords(500);

  // Build a map of handle -> analytics
  const metricsMap = useMemo(() => {
    const map: Record<
      string,
      { new_visitors: number; signups: number; signup_rate: number }
    > = {};
    for (const row of metrics.data?.rows ?? []) {
      const handle = String(row.handle ?? "");
      if (handle) {
        map[handle] = {
          new_visitors: Number(row.new_visitors ?? 0),
          signups: Number(row.signups ?? 0),
          signup_rate: Number(row.signup_rate ?? 0),
        };
      }
    }
    return map;
  }, [metrics.data]);

  // Build handle -> title map from Notion for SEO tab
  const notionTitles = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of allEntries) {
      if (e.handle && e.title) m[e.handle] = e.title;
    }
    return m;
  }, [allEntries]);

  const notionAuthors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of allEntries) {
      if (e.handle && e.author) m[e.handle] = e.author;
    }
    return m;
  }, [allEntries]);

  const isNotionError = !!notionError;
  const publishedCount = allEntries.filter((e) => e.handle).length;
  const draftCount = allEntries.length - publishedCount;

  return (
    <div className="space-y-4">
      {/* Tab navigation */}
      <div className="flex items-center gap-4 border-b border-border pb-0">
        {(
          [
            ["calendar", "Content SEO"],
            ["seo", "SEO Rankings"],
            ["striking", "Striking Distance"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border p-3 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Filters
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <DateRangeInput
            label="Analytics Date Range"
            startDate={f.dateStart}
            endDate={f.dateEnd}
            onStartChange={(v) => setF("dateStart", v)}
            onEndChange={(v) => setF("dateEnd", v)}
          />
          {tab === "calendar" && (
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                View
              </label>
              <div className="flex rounded-md overflow-hidden border border-border text-xs">
                {(
                  [
                    ["published", `Published (${publishedCount})`],
                    ["all", `All (${allEntries.length})`],
                    ["drafts", `Drafts (${draftCount})`],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-3 py-1.5 transition-colors ${
                      viewMode === mode
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/30 hover:bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notion connection error notice */}
      {isNotionError && (
        <Card className="bg-amber-950/20 border-amber-500/30">
          <CardContent className="py-3 px-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs space-y-1">
              <p className="font-medium text-amber-400">
                Notion database not accessible
              </p>
              <p className="text-muted-foreground">
                The content calendar database needs to be shared with the Notion
                integration. In Notion, open the database page, click the
                &ldquo;...&rdquo; menu in the top right, select
                &ldquo;Connections&rdquo;, and add the integration that was
                created for this API key.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab content */}
      {tab === "calendar" ? (
        <CalendarTable
          entries={entries}
          metricsMap={metricsMap}
          seoData={seo.data?.pages}
          isLoading={calendar.isLoading}
          metricsLoading={metrics.isLoading}
          seoLoading={seo.isLoading}
          error={
            isNotionError
              ? "Could not load Notion database. See notice above."
              : undefined
          }
        />
      ) : tab === "seo" ? (
        <SeoRankingsTab
          keywords={topKeywords.data?.keywords ?? []}
          metricsMap={metricsMap}
          notionTitles={notionTitles}
          notionAuthors={notionAuthors}
          isLoading={topKeywords.isLoading}
          metricsLoading={metrics.isLoading}
        />
      ) : (
        <StrikingDistanceTab
          keywords={topKeywords.data?.keywords ?? []}
          notionTitles={notionTitles}
          isLoading={topKeywords.isLoading}
          excludeWords={f.sdExclude}
          onExcludeWordsChange={(words) => setF("sdExclude", words)}
        />
      )}
    </div>
  );
}
