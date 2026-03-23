import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "../top-funnel/types";
import type { ContentCalendarEntry, BlogPageSeo } from "@/lib/api-hooks";
import { useBlogKeywords } from "@/lib/api-hooks";
import type { RankedKeyword } from "@/lib/api-hooks";

interface EnrichedEntry extends ContentCalendarEntry {
  new_visitors: number;
  signups: number;
  signup_rate: number;
  seo_etv: number;
  seo_keywords: number;
}

interface Column {
  key: keyof EnrichedEntry | string;
  label: string;
  format: "text" | "number" | "percent";
  width?: string;
}

const COLUMNS: Column[] = [
  { key: "title", label: "Title", format: "text", width: "min-w-[250px]" },
  { key: "author", label: "Author", format: "text" },
  { key: "signups", label: "Signups", format: "number" },
  { key: "new_visitors", label: "Traffic", format: "number" },
  { key: "signup_rate", label: "Signup %", format: "percent" },
  { key: "seo_etv", label: "SEO ETV", format: "number" },
  { key: "seo_keywords", label: "Ranked KWs", format: "number" },
  { key: "seoKeyword", label: "Target KW", format: "text" },
  { key: "msv", label: "MSV", format: "number" },
  { key: "status", label: "Status", format: "text" },
  { key: "publishDate", label: "Pub Date", format: "text" },
];

interface CalendarTableProps {
  entries: ContentCalendarEntry[];
  metricsMap: Record<
    string,
    { new_visitors: number; signups: number; signup_rate: number }
  >;
  seoData?: Record<string, BlogPageSeo>;
  isLoading?: boolean;
  metricsLoading?: boolean;
  seoLoading?: boolean;
  error?: string;
}

export function CalendarTable({
  entries,
  metricsMap,
  seoData,
  isLoading,
  metricsLoading,
  seoLoading,
  error,
}: CalendarTableProps) {
  const [sortCol, setSortCol] = useState("publishDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  const enriched: EnrichedEntry[] = useMemo(() => {
    return entries.map((entry) => {
      const metrics = entry.handle ? metricsMap[entry.handle] : undefined;
      const seo = entry.handle ? seoData?.[entry.handle] : undefined;
      return {
        ...entry,
        new_visitors: metrics?.new_visitors ?? 0,
        signups: metrics?.signups ?? 0,
        signup_rate: metrics?.signup_rate ?? 0,
        seo_etv: seo?.etv ?? 0,
        seo_keywords: seo?.ranked_keywords ?? 0,
      };
    });
  }, [entries, metricsMap, seoData]);

  const sorted = useMemo(() => {
    return [...enriched]
      .sort((a, b) => {
        const aVal = (a as any)[sortCol];
        const bVal = (b as any)[sortCol];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        // Treat empty strings as null for sorting (push to end)
        if (aVal === "" && bVal === "") return 0;
        if (aVal === "") return 1;
        if (bVal === "") return -1;
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        }
        return sortDir === "asc"
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      })
      .slice(0, 500);
  }, [enriched, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const formatVal = (val: unknown, format: Column["format"]): string => {
    if (val == null || val === "") return "-";
    switch (format) {
      case "number":
        return formatNumber(Number(val));
      case "percent":
        return formatPercent(Number(val));
      default:
        return String(val);
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col)
      return <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 text-foreground" />
    ) : (
      <ArrowDown className="h-3 w-3 text-foreground" />
    );
  };

  const loadingHint =
    (metricsLoading ? "analytics" : "") +
    (metricsLoading && seoLoading ? " + " : "") +
    (seoLoading ? "SEO" : "");

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium">Content SEO</CardTitle>
          {loadingHint && (
            <span className="text-[10px] text-muted-foreground animate-pulse">
              Loading {loadingHint} data...
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-red-400 py-4 text-center">{error}</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No entries found
          </p>
        ) : (
          <div className="overflow-auto max-h-[700px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="w-6 py-2 px-1" />
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={cn(
                        "text-left py-2 px-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none",
                        col.width,
                      )}
                      onClick={() => handleSort(col.key)}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        <SortIcon col={col.key} />
                      </span>
                    </th>
                  ))}
                  <th className="w-6 py-2 px-1" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry) => {
                  const isExpanded = expandedSlug === entry.handle;
                  return (
                    <>
                      <tr
                        key={entry.id}
                        className={cn(
                          "border-b border-border/30 hover:bg-muted/30",
                          entry.handle && "cursor-pointer",
                          isExpanded && "bg-muted/20",
                        )}
                        onClick={() =>
                          entry.handle &&
                          setExpandedSlug(isExpanded ? null : entry.handle)
                        }
                      >
                        <td className="py-1.5 px-1 text-muted-foreground">
                          {entry.handle ? (
                            isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )
                          ) : null}
                        </td>
                        {COLUMNS.map((col) => (
                          <td
                            key={col.key}
                            className={cn(
                              "py-1.5 px-2 whitespace-nowrap",
                              col.format === "text"
                                ? "max-w-[250px] truncate"
                                : "text-right tabular-nums",
                              col.key === "title" && "font-medium",
                              col.key === "signups" && "text-emerald-400",
                              (col.key === "seo_etv" ||
                                col.key === "seo_keywords") &&
                                "text-blue-400",
                              col.key === "status" && statusColor(entry.status),
                            )}
                            title={
                              col.format === "text"
                                ? String((entry as any)[col.key] ?? "")
                                : undefined
                            }
                          >
                            {formatVal((entry as any)[col.key], col.format)}
                          </td>
                        ))}
                        <td className="py-1.5 px-1">
                          {entry.url && (
                            <a
                              href={entry.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </td>
                      </tr>
                      {isExpanded && entry.handle && (
                        <tr key={`${entry.id}-kw`}>
                          <td colSpan={COLUMNS.length + 2} className="p-0">
                            <KeywordDrillDown slug={entry.handle} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("publish") || s.includes("done") || s.includes("live"))
    return "text-emerald-400";
  if (s.includes("review") || s.includes("editing")) return "text-yellow-400";
  if (s.includes("draft") || s.includes("writing") || s.includes("progress"))
    return "text-orange-400";
  if (s.includes("idea") || s.includes("backlog") || s.includes("plan"))
    return "text-muted-foreground";
  return "";
}

function KeywordDrillDown({ slug }: { slug: string }) {
  const { data, isLoading, error } = useBlogKeywords(slug);

  if (isLoading) {
    return (
      <div className="px-8 py-3">
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-8 py-2 text-xs text-red-400">
        Failed to load keywords
      </div>
    );
  }

  const keywords = data?.keywords ?? [];
  if (!keywords.length) {
    return (
      <div className="px-8 py-2 text-xs text-muted-foreground">
        No ranked keywords found
      </div>
    );
  }

  return (
    <div className="px-8 py-2 bg-muted/10 border-b border-border/30">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
        Top Ranked Keywords
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left py-1 px-2 font-medium">Keyword</th>
            <th className="text-right py-1 px-2 font-medium">Rank</th>
            <th className="text-right py-1 px-2 font-medium">Search Vol</th>
            <th className="text-right py-1 px-2 font-medium">Est. Traffic</th>
          </tr>
        </thead>
        <tbody>
          {keywords.slice(0, 10).map((kw: RankedKeyword, i: number) => (
            <tr key={i} className="border-t border-border/20">
              <td className="py-1 px-2">{kw.keyword}</td>
              <td className="py-1 px-2 text-right tabular-nums">
                <RankBadge rank={kw.rank_absolute} />
              </td>
              <td className="py-1 px-2 text-right tabular-nums">
                {formatNumber(kw.search_volume)}
              </td>
              <td className="py-1 px-2 text-right tabular-nums text-blue-400">
                {formatNumber(Math.round(kw.etv))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const color =
    rank <= 3
      ? "text-emerald-400"
      : rank <= 10
        ? "text-yellow-400"
        : rank <= 20
          ? "text-orange-400"
          : "text-muted-foreground";
  return <span className={cn("font-semibold", color)}>#{rank}</span>;
}
