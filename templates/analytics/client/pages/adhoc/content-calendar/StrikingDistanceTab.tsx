import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "../top-funnel/types";
import type { BlogKeywordRanking } from "@/lib/api-hooks";

interface StrikingDistanceTabProps {
  keywords: BlogKeywordRanking[];
  notionTitles: Record<string, string>;
  isLoading: boolean;
  excludeWords: string[];
  onExcludeWordsChange: (words: string[]) => void;
}

interface OpportunityItem extends BlogKeywordRanking {
  potentialGain: number;
  title: string;
}

export function StrikingDistanceTab({
  keywords,
  notionTitles,
  isLoading,
  excludeWords,
  onExcludeWordsChange,
}: StrikingDistanceTabProps) {
  const [minVol, setMinVol] = useState<number>(100);
  const [rankRange, setRankRange] = useState<[number, number]>([6, 20]);
  const [excludeInput, setExcludeInput] = useState<string>("");
  const [expandedKw, setExpandedKw] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string>("potentialGain");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleAddExcludeWord = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && excludeInput.trim()) {
      e.preventDefault();
      const newWord = excludeInput.trim().toLowerCase();
      if (!excludeWords.includes(newWord)) {
        onExcludeWordsChange([...excludeWords, newWord]);
      }
      setExcludeInput("");
    }
  };

  const removeExcludeWord = (word: string) => {
    onExcludeWordsChange(excludeWords.filter((w) => w !== word));
  };

  const opportunities: OpportunityItem[] = useMemo(() => {
    const excludedList = excludeWords.map(w => w.toLowerCase());

    return keywords
      .filter((kw) => {
        if (kw.rank_absolute < rankRange[0] || kw.rank_absolute > rankRange[1]) return false;
        if (kw.search_volume < minVol) return false;
        const kwLower = kw.keyword.toLowerCase();
        if (excludedList.some((ex) => kwLower.includes(ex))) return false;
        return true;
      })
      .map((kw) => {
        // Simple heuristic: Top 3 gets ~30% of traffic.
        // Current traffic at rank > 5 is roughly 1-3%.
        // We'll estimate potential gain as ~25% of search volume.
        const potentialGain = kw.search_volume * 0.25;
        return {
          ...kw,
          potentialGain,
          title: notionTitles[kw.handle] || kw.handle.replace(/-/g, " "),
        };
      });
  }, [keywords, rankRange, minVol, excludeWords, notionTitles]);

  const sortedOpps = useMemo(() => {
    return [...opportunities].sort((a, b) => {
      // Add current_traffic custom sort logic since it's not a real prop
      let aVal, bVal;

      if (sortCol === "current_traffic") {
        aVal = a.etv;
        bVal = b.etv;
      } else {
        aVal = (a as any)[sortCol] ?? 0;
        bVal = (b as any)[sortCol] ?? 0;
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [opportunities, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const totalGain = opportunities.reduce((s, k) => s + k.potentialGain, 0);
  const avgVol =
    opportunities.length > 0
      ? opportunities.reduce((s, k) => s + k.search_volume, 0) /
        opportunities.length
      : 0;

  if (isLoading) {
    return (
      <Card className="bg-card border-border/50">
        <CardContent className="py-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const cols = [
    { key: "keyword", label: "Target Keyword", type: "text" as const },
    { key: "rank_absolute", label: "Current Rank", type: "num" as const },
    { key: "current_traffic", label: "Current Traffic", type: "num" as const },
    { key: "search_volume", label: "Search Volume", type: "num" as const },
    { key: "potentialGain", label: "Potential Gain", type: "num" as const },
    { key: "title", label: "Article", type: "text" as const },
  ];

  return (
    <div className="space-y-4">
      {/* Top Level KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/50 bg-card p-4 flex flex-col justify-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            <TrendingUp className="h-3.5 w-3.5" /> Total Potential Traffic Gain
          </p>
          <p className="text-2xl font-bold text-emerald-400 tabular-nums">
            +{formatNumber(Math.round(totalGain))} <span className="text-sm font-normal text-muted-foreground">/ mo</span>
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-4 flex flex-col justify-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            Quick Win Opportunities
          </p>
          <p className="text-2xl font-bold tabular-nums">
            {formatNumber(opportunities.length)} <span className="text-sm font-normal text-muted-foreground">keywords</span>
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-4 flex flex-col justify-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            Avg Search Volume (Filtered)
          </p>
          <p className="text-2xl font-bold tabular-nums">
            {formatNumber(Math.round(avgVol))}
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Position Range (Rank)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={rankRange[0]}
                  onChange={(e) => setRankRange([Number(e.target.value), rankRange[1]])}
                  className="w-full bg-muted/50 border border-border rounded-md px-2 py-1 text-sm text-foreground"
                />
                <span className="text-muted-foreground self-center">to</span>
                <input
                  type="number"
                  value={rankRange[1]}
                  onChange={(e) => setRankRange([rankRange[0], Number(e.target.value)])}
                  className="w-full bg-muted/50 border border-border rounded-md px-2 py-1 text-sm text-foreground"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">Typically 11-20 (Page 2)</p>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Min Search Volume</label>
              <input
                type="number"
                value={minVol}
                onChange={(e) => setMinVol(Number(e.target.value))}
                className="w-full bg-muted/50 border border-border rounded-md px-2 py-1 text-sm text-foreground"
              />
              <p className="text-[10px] text-muted-foreground">Filter out long-tail noise</p>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Exclude Keywords</label>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5 min-h-[32px] p-1.5 bg-muted/30 border border-border rounded-md">
                  {excludeWords.map((word) => (
                    <Badge key={word} variant="secondary" className="text-[10px] font-normal py-0 pl-2 pr-1 h-5 gap-1 hover:bg-muted">
                      {word}
                      <button
                        onClick={() => removeExcludeWord(word)}
                        className="text-muted-foreground hover:text-foreground rounded-full p-0.5 transition-colors flex items-center justify-center"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                  <input
                    type="text"
                    placeholder="Type and press Enter..."
                    value={excludeInput}
                    onChange={(e) => setExcludeInput(e.target.value)}
                    onKeyDown={handleAddExcludeWord}
                    className="flex-1 bg-transparent border-none outline-none min-w-[120px] px-1 text-foreground text-xs"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Type a phrase and press Enter to ignore it.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Low-Hanging Fruit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="w-6 py-2 px-1" />
                  {cols.map((col) => (
                    <th
                      key={col.key}
                      className={cn(
                        "py-2 px-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none",
                        col.type === "text" ? "text-left" : "text-right"
                      )}
                      onClick={() => handleSort(col.key)}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedOpps.length === 0 ? (
                  <tr>
                    <td colSpan={cols.length + 2} className="py-8 text-center text-muted-foreground">
                      No keywords found matching these filters.
                    </td>
                  </tr>
                ) : (
                  sortedOpps.map((opp, i) => {
                    const isExpanded = expandedKw === opp.keyword;
                    return (
                      <React.Fragment key={`${opp.keyword}-${i}`}>
                        <tr
                          className={cn(
                            "border-b border-border/30 hover:bg-muted/30 cursor-pointer",
                            isExpanded && "bg-muted/20"
                          )}
                          onClick={() => setExpandedKw(isExpanded ? null : opp.keyword)}
                        >
                          <td className="py-1.5 px-1 text-muted-foreground">
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </td>
                          <td className="py-1.5 px-2 font-medium max-w-[200px] truncate" title={opp.keyword}>
                            {opp.keyword}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums">
                            <span className="text-orange-400 font-semibold">#{opp.rank_absolute}</span>
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums">
                            {formatNumber(Math.round(opp.etv))}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums">
                            {formatNumber(opp.search_volume)}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-emerald-400 font-medium">
                            +{formatNumber(Math.round(opp.potentialGain))}
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground max-w-[200px] truncate" title={opp.title}>
                            {opp.title}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${opp.keyword}-details`}>
                            <td colSpan={cols.length + 1} className="p-0">
                              <AuditPanel opp={opp} allKeywords={keywords} excludeWords={excludeWords} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AuditPanel({ opp, allKeywords, excludeWords }: { opp: OpportunityItem; allKeywords: BlogKeywordRanking[]; excludeWords: string[] }) {
  const otherKeywords = useMemo(() => {
    const excludedList = excludeWords.map((w) => w.toLowerCase());
    return allKeywords
      .filter((k) => {
        if (k.handle !== opp.handle || k.keyword === opp.keyword) return false;
        const kwLower = k.keyword.toLowerCase();
        if (excludedList.some((ex) => kwLower.includes(ex))) return false;
        return true;
      })
      .sort((a, b) => b.etv - a.etv)
      .slice(0, 10);
  }, [allKeywords, opp.handle, opp.keyword, excludeWords]);

  return (
    <div className="px-8 py-4 bg-muted/10 border-b border-border/30">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 bg-background border border-border/50 rounded-lg p-4">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Target Keyword</p>
          <p className="text-sm font-medium text-foreground">{opp.keyword}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Current Rank</p>
          <p className="text-sm font-medium text-orange-400">#{opp.rank_absolute}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Current Est. Traffic</p>
          <p className="text-sm font-medium">{formatNumber(Math.round(opp.etv))} <span className="text-[10px] text-muted-foreground font-normal">/mo</span></p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Top 3 Est. Traffic</p>
          <p className="text-sm font-medium text-emerald-400">~{formatNumber(Math.round(opp.potentialGain))} <span className="text-[10px] text-emerald-400/70 font-normal">/mo</span></p>
        </div>
      </div>

      {otherKeywords.length > 0 && (
        <div className="mt-4 border border-border/50 rounded-md bg-background overflow-hidden">
          <div className="px-3 py-2 bg-muted/30 border-b border-border/50 flex items-center justify-between">
            <h4 className="text-xs font-medium text-foreground">Other Keywords for this Article</h4>
            <span className="text-[10px] text-muted-foreground">Showing top {otherKeywords.length}</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30 text-muted-foreground bg-muted/10">
                <th className="py-1.5 px-3 text-left font-medium">Target Keyword</th>
                <th className="py-1.5 px-3 text-right font-medium">Current Rank</th>
                <th className="py-1.5 px-3 text-right font-medium">Current Traffic</th>
                <th className="py-1.5 px-3 text-right font-medium">Search Volume</th>
                <th className="py-1.5 px-3 text-right font-medium">Potential Gain</th>
                <th className="py-1.5 px-3 text-left font-medium">Article</th>
              </tr>
            </thead>
            <tbody>
              {otherKeywords.map((kw, i) => {
                const currentTraffic = Math.round(kw.etv);
                const potentialGain = Math.round(kw.search_volume * 0.25);
                return (
                  <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10">
                    <td className="py-1.5 px-3 font-medium text-muted-foreground max-w-[200px] truncate" title={kw.keyword}>{kw.keyword}</td>
                    <td className="py-1.5 px-3 text-right">
                      <span className={cn(
                        "font-medium",
                        kw.rank_absolute <= 3 ? "text-emerald-400" :
                        kw.rank_absolute <= 10 ? "text-yellow-400" :
                        kw.rank_absolute <= 20 ? "text-orange-400" : "text-muted-foreground"
                      )}>
                        #{kw.rank_absolute}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">{formatNumber(currentTraffic)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">{formatNumber(kw.search_volume)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-emerald-400 font-medium">+{formatNumber(potentialGain)}</td>
                    <td className="py-1.5 px-3 text-muted-foreground max-w-[200px] truncate" title={opp.title}>{opp.title}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
