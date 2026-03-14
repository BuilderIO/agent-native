import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  TrendingUp,
  TrendingDown,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "../top-funnel/types";
import type { BlogKeywordRanking } from "@/lib/api-hooks";

// -- Types --

interface ArticleRollup {
  handle: string;
  title: string;
  author: string;
  signups: number;
  traffic: number;
  totalEtv: number;
  keywordCount: number;
  topKeyword: string;
  topKeywordRank: number;
  keywords: BlogKeywordRanking[];
}

interface SeoRankingsTabProps {
  keywords: BlogKeywordRanking[];
  metricsMap: Record<
    string,
    { new_visitors: number; signups: number; signup_rate: number }
  >;
  notionTitles: Record<string, string>;
  notionAuthors: Record<string, string>;
  isLoading: boolean;
  metricsLoading: boolean;
}

// -- Main component --

export function SeoRankingsTab({
  keywords,
  metricsMap,
  notionTitles,
  notionAuthors,
  isLoading,
  metricsLoading,
}: SeoRankingsTabProps) {
  const [view, setView] = useState<"articles" | "keywords">("articles");

  if (isLoading) {
    return (
      <Card className="bg-card border-border/50">
        <CardContent className="py-6">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <SeoSummary keywords={keywords} />

      {/* View toggle */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-md overflow-hidden border border-border text-xs">
          {(
            [
              ["articles", "By Article"],
              ["keywords", "All Keywords"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className={`px-3 py-1.5 transition-colors ${
                view === mode
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/30 hover:bg-muted/50 text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "articles" ? (
        <ArticleRankingsTable
          keywords={keywords}
          metricsMap={metricsMap}
          notionTitles={notionTitles}
          notionAuthors={notionAuthors}
          metricsLoading={metricsLoading}
        />
      ) : (
        <KeywordFlatTable keywords={keywords} notionTitles={notionTitles} />
      )}
    </div>
  );
}

// -- Summary cards --

function SeoSummary({ keywords }: { keywords: BlogKeywordRanking[] }) {
  const stats = useMemo(() => {
    const handles = new Set(keywords.map((k) => k.handle));
    const totalEtv = keywords.reduce((s, k) => s + k.etv, 0);
    const top3 = keywords.filter((k) => k.rank_absolute <= 3).length;
    const top10 = keywords.filter((k) => k.rank_absolute <= 10).length;
    const rising = keywords.filter((k) => k.is_up).length;
    const falling = keywords.filter((k) => k.is_down).length;
    const newKw = keywords.filter((k) => k.is_new).length;
    return {
      pages: handles.size,
      totalEtv,
      top3,
      top10,
      rising,
      falling,
      newKw,
      total: keywords.length,
    };
  }, [keywords]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {[
        {
          label: "Total Keywords",
          value: formatNumber(stats.total),
          color: "",
        },
        { label: "Blog Pages", value: formatNumber(stats.pages), color: "" },
        {
          label: "Est. Traffic Value",
          value: `$${formatNumber(Math.round(stats.totalEtv))}`,
          color: "text-blue-400",
        },
        {
          label: "Top 3 Positions",
          value: formatNumber(stats.top3),
          color: "text-emerald-400",
        },
        {
          label: "Top 10",
          value: formatNumber(stats.top10),
          color: "text-yellow-400",
        },
        {
          label: "Rising",
          value: formatNumber(stats.rising),
          color: "text-emerald-400",
        },
        {
          label: "Falling",
          value: formatNumber(stats.falling),
          color: "text-red-400",
        },
      ].map((s) => (
        <div
          key={s.label}
          className="rounded-lg border border-border/50 bg-card p-2.5 text-center"
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {s.label}
          </p>
          <p className={cn("text-lg font-semibold tabular-nums", s.color)}>
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// -- Article-grouped rankings table --

function ArticleRankingsTable({
  keywords,
  metricsMap,
  notionTitles,
  notionAuthors,
  metricsLoading,
}: {
  keywords: BlogKeywordRanking[];
  metricsMap: Record<
    string,
    { new_visitors: number; signups: number; signup_rate: number }
  >;
  notionTitles: Record<string, string>;
  notionAuthors: Record<string, string>;
  metricsLoading: boolean;
}) {
  const [sortCol, setSortCol] = useState<string>("totalEtv");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedHandle, setExpandedHandle] = useState<string | null>(null);

  const articles: ArticleRollup[] = useMemo(() => {
    const byHandle = new Map<string, BlogKeywordRanking[]>();
    for (const kw of keywords) {
      if (!kw.handle) continue;
      const existing = byHandle.get(kw.handle) ?? [];
      existing.push(kw);
      byHandle.set(kw.handle, existing);
    }

    return Array.from(byHandle.entries()).map(([handle, kws]) => {
      const sorted = [...kws].sort((a, b) => b.etv - a.etv);
      const m = metricsMap[handle];
      return {
        handle,
        title: notionTitles[handle] || handle.replace(/-/g, " "),
        author: notionAuthors[handle] || "",
        signups: m?.signups ?? 0,
        traffic: m?.new_visitors ?? 0,
        totalEtv: kws.reduce((s, k) => s + k.etv, 0),
        keywordCount: kws.length,
        topKeyword: sorted[0]?.keyword ?? "",
        topKeywordRank: sorted[0]?.rank_absolute ?? 999,
        keywords: sorted,
      };
    });
  }, [keywords, metricsMap, notionTitles, notionAuthors]);

  const sorted = useMemo(() => {
    return [...articles].sort((a, b) => {
      const aVal = (a as any)[sortCol] ?? 0;
      const bVal = (b as any)[sortCol] ?? 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [articles, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const cols = [
    { key: "title", label: "Article", type: "text" as const },
    { key: "author", label: "Author", type: "text" as const },
    { key: "signups", label: "Signups", type: "num" as const },
    { key: "traffic", label: "Traffic", type: "num" as const },
    { key: "totalEtv", label: "SEO ETV", type: "num" as const },
    { key: "keywordCount", label: "Keywords", type: "num" as const },
    { key: "topKeyword", label: "Top Keyword", type: "text" as const },
    { key: "topKeywordRank", label: "Best Rank", type: "num" as const },
  ];

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium">
            Article SEO Rankings
          </CardTitle>
          {metricsLoading && (
            <span className="text-[10px] text-muted-foreground animate-pulse">
              Loading analytics...
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto max-h-[700px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border">
                <th className="w-6 py-2 px-1" />
                {cols.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "py-2 px-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none",
                      col.type === "text"
                        ? "text-left min-w-[200px]"
                        : "text-right",
                    )}
                    onClick={() => handleSort(col.key)}
                  >
                    <span className="flex items-center gap-1">
                      {col.label}
                      <SortIcon
                        col={col.key}
                        sortCol={sortCol}
                        sortDir={sortDir}
                      />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((article) => {
                const isExpanded = expandedHandle === article.handle;
                return (
                  <>
                    <tr
                      key={article.handle}
                      className={cn(
                        "border-b border-border/30 hover:bg-muted/30 cursor-pointer",
                        isExpanded && "bg-muted/20",
                      )}
                      onClick={() =>
                        setExpandedHandle(isExpanded ? null : article.handle)
                      }
                    >
                      <td className="py-1.5 px-1 text-muted-foreground">
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </td>
                      <td
                        className="py-1.5 px-2 font-medium max-w-[300px] truncate"
                        title={article.title}
                      >
                        {article.title}
                      </td>
                      <td
                        className="py-1.5 px-2 text-muted-foreground max-w-[120px] truncate"
                        title={article.author}
                      >
                        {article.author || "-"}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-emerald-400">
                        {formatNumber(article.signups)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {formatNumber(article.traffic)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-blue-400">
                        ${formatNumber(Math.round(article.totalEtv))}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {article.keywordCount}
                      </td>
                      <td
                        className="py-1.5 px-2 max-w-[200px] truncate text-muted-foreground"
                        title={article.topKeyword}
                      >
                        {article.topKeyword}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        <RankBadge rank={article.topKeywordRank} />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${article.handle}-kw`}>
                        <td colSpan={cols.length + 1} className="p-0">
                          <ExpandedKeywords keywords={article.keywords} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// -- Flat keyword table --

function KeywordFlatTable({
  keywords,
  notionTitles,
}: {
  keywords: BlogKeywordRanking[];
  notionTitles: Record<string, string>;
}) {
  const [sortCol, setSortCol] = useState<string>("etv");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    return [...keywords].sort((a, b) => {
      const aVal = (a as any)[sortCol] ?? 0;
      const bVal = (b as any)[sortCol] ?? 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [keywords, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const cols = [
    { key: "keyword", label: "Keyword", type: "text" as const },
    { key: "rank_absolute", label: "Rank", type: "num" as const },
    { key: "trend", label: "Trend", type: "custom" as const },
    { key: "search_volume", label: "Search Vol", type: "num" as const },
    { key: "etv", label: "Est. Traffic", type: "num" as const },
    { key: "handle", label: "Article", type: "text" as const },
  ];

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          All Ranked Keywords
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto max-h-[700px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border">
                {cols.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "py-2 px-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none",
                      col.type === "text" ? "text-left" : "text-right",
                    )}
                    onClick={() => col.key !== "trend" && handleSort(col.key)}
                  >
                    <span className="flex items-center gap-1">
                      {col.label}
                      {col.key !== "trend" && (
                        <SortIcon
                          col={col.key}
                          sortCol={sortCol}
                          sortDir={sortDir}
                        />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 500).map((kw, i) => (
                <tr
                  key={`${kw.keyword}-${kw.handle}-${i}`}
                  className="border-b border-border/30 hover:bg-muted/30"
                >
                  <td
                    className="py-1.5 px-2 font-medium max-w-[250px] truncate"
                    title={kw.keyword}
                  >
                    {kw.keyword}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    <RankBadge rank={kw.rank_absolute} />
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <TrendIndicator kw={kw} />
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {formatNumber(kw.search_volume)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-blue-400">
                    {formatNumber(Math.round(kw.etv))}
                  </td>
                  <td
                    className="py-1.5 px-2 max-w-[200px] truncate text-muted-foreground"
                    title={notionTitles[kw.handle] || kw.handle}
                  >
                    {notionTitles[kw.handle] || kw.handle.replace(/-/g, " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// -- Expanded keywords for article drill-down --

function ExpandedKeywords({ keywords }: { keywords: BlogKeywordRanking[] }) {
  return (
    <div className="px-8 py-2 bg-muted/10 border-b border-border/30">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
        Ranked Keywords ({keywords.length})
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left py-1 px-2 font-medium">Keyword</th>
            <th className="text-right py-1 px-2 font-medium">Rank</th>
            <th className="text-right py-1 px-2 font-medium">Trend</th>
            <th className="text-right py-1 px-2 font-medium">Search Vol</th>
            <th className="text-right py-1 px-2 font-medium">Est. Traffic</th>
          </tr>
        </thead>
        <tbody>
          {keywords.slice(0, 20).map((kw, i) => (
            <tr key={i} className="border-t border-border/20">
              <td className="py-1 px-2">{kw.keyword}</td>
              <td className="py-1 px-2 text-right tabular-nums">
                <RankBadge rank={kw.rank_absolute} />
              </td>
              <td className="py-1 px-2 text-right">
                <TrendIndicator kw={kw} />
              </td>
              <td className="py-1 px-2 text-right tabular-nums">
                {formatNumber(kw.search_volume)}
              </td>
              <td className="py-1 px-2 text-right tabular-nums text-blue-400">
                {formatNumber(Math.round(kw.etv))}
              </td>
            </tr>
          ))}
          {keywords.length > 20 && (
            <tr>
              <td
                colSpan={5}
                className="py-1 px-2 text-muted-foreground text-center"
              >
                +{keywords.length - 20} more keywords
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// -- Shared UI components --

function TrendIndicator({ kw }: { kw: BlogKeywordRanking }) {
  if (kw.is_new) {
    return (
      <span className="inline-flex items-center gap-0.5 text-purple-400">
        <Sparkles className="h-3 w-3" />
        <span className="text-[10px]">New</span>
      </span>
    );
  }
  if (kw.is_up && kw.prev_rank_absolute != null) {
    const diff = kw.prev_rank_absolute - kw.rank_absolute;
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-400">
        <TrendingUp className="h-3 w-3" />
        <span className="text-[10px]">+{diff}</span>
      </span>
    );
  }
  if (kw.is_down && kw.prev_rank_absolute != null) {
    const diff = kw.rank_absolute - kw.prev_rank_absolute;
    return (
      <span className="inline-flex items-center gap-0.5 text-red-400">
        <TrendingDown className="h-3 w-3" />
        <span className="text-[10px]">-{diff}</span>
      </span>
    );
  }
  return <span className="text-muted-foreground/50">-</span>;
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

function SortIcon({
  col,
  sortCol,
  sortDir,
}: {
  col: string;
  sortCol: string;
  sortDir: "asc" | "desc";
}) {
  if (sortCol !== col)
    return <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />;
  return sortDir === "asc" ? (
    <ArrowUp className="h-3 w-3 text-foreground" />
  ) : (
    <ArrowDown className="h-3 w-3 text-foreground" />
  );
}
