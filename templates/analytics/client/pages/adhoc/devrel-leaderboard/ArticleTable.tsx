import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "../top-funnel/types";
import type { BlogPageSeo, RankedKeyword } from "@/lib/api-hooks";
import { useBlogKeywords } from "@/lib/api-hooks";

interface Column {
  key: string;
  label: string;
  format: "text" | "number" | "percent" | "seo";
  width?: string;
}

const COLUMNS: Column[] = [
  { key: "base_url", label: "URL", format: "text", width: "min-w-[200px]" },
  { key: "author", label: "Author", format: "text" },
  { key: "signups", label: "Signups", format: "number" },
  { key: "new_visitors", label: "Traffic", format: "number" },
  { key: "signup_rate", label: "Signup %", format: "percent" },
  { key: "seo_etv", label: "SEO ETV", format: "number" },
  { key: "seo_keywords", label: "Ranked KWs", format: "number" },
  { key: "pub_date", label: "Pub Date", format: "text" },
  { key: "type", label: "Topic", format: "text" },
];

interface ArticleTableProps {
  rows: Record<string, unknown>[];
  seoData?: Record<string, BlogPageSeo>;
  isLoading?: boolean;
  seoLoading?: boolean;
  error?: string;
}

export function ArticleTable({
  rows,
  seoData,
  isLoading,
  seoLoading,
  error,
}: ArticleTableProps) {
  const [sortCol, setSortCol] = useState("signups");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  // Merge SEO data into rows
  const enrichedRows = useMemo((): Record<string, unknown>[] => {
    return rows.map((row) => {
      const handle = String(row.handle ?? "");
      const seo = seoData?.[handle];
      return {
        ...row,
        seo_etv: seo?.etv ?? null,
        seo_keywords: seo?.ranked_keywords ?? null,
      };
    });
  }, [rows, seoData]);

  const sorted = useMemo(() => {
    return [...enrichedRows]
      .sort((a, b) => {
        const aVal = a[sortCol];
        const bVal = b[sortCol];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        }
        return sortDir === "asc"
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      })
      .slice(0, 300);
  }, [enrichedRows, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const formatVal = (val: unknown, format: Column["format"]): string => {
    if (val == null) return "-";
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

  return (
    <Card className="bg-muted/30 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium">
            Article Breakdown
          </CardTitle>
          {seoLoading && (
            <span className="text-[10px] text-muted-foreground animate-pulse">
              Loading SEO data...
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-red-400 py-4 text-center">{error}</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No data
          </p>
        ) : (
          <div className="overflow-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead
                className="sticky top-0 z-10"
                style={{ backgroundColor: "hsl(var(--table-header))" }}
              >
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
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const slug = String(row.handle ?? "");
                  const isExpanded = expandedSlug === slug;
                  return (
                    <>
                      <tr
                        key={i}
                        className={cn(
                          "border-b border-border/30 hover:bg-muted/30 cursor-pointer",
                          isExpanded && "bg-muted/20",
                        )}
                        onClick={() =>
                          setExpandedSlug(isExpanded ? null : slug)
                        }
                      >
                        <td className="py-1.5 px-1 text-muted-foreground">
                          {slug ? (
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
                                ? "max-w-[220px] truncate"
                                : "text-right tabular-nums",
                              col.key === "base_url" && "font-mono text-[11px]",
                              (col.key === "seo_etv" ||
                                col.key === "seo_keywords") &&
                                "text-blue-400",
                            )}
                            title={
                              col.format === "text"
                                ? String(row[col.key] ?? "")
                                : undefined
                            }
                          >
                            {formatVal(row[col.key], col.format)}
                          </td>
                        ))}
                      </tr>
                      {isExpanded && slug && (
                        <tr key={`${i}-kw`}>
                          <td colSpan={COLUMNS.length + 1} className="p-0">
                            <KeywordDrillDown slug={slug} />
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
