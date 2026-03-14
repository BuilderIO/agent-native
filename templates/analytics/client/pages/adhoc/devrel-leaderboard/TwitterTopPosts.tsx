import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, Heart, Repeat2, Eye, MessageCircle } from "lucide-react";
import { type ParsedTweet } from "./TwitterSection";

type SortKey = "likeCount" | "retweetCount" | "replyCount" | "viewCount" | "createdAt";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "likeCount", label: "Likes" },
  { key: "retweetCount", label: "RTs" },
  { key: "replyCount", label: "Replies" },
  { key: "viewCount", label: "Views" },
  { key: "createdAt", label: "Date" },
];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface Props {
  tweets: ParsedTweet[];
  isLoading: boolean;
  selectedAuthor: string | null;
  onClearFilter: () => void;
}

export function TwitterTopPosts({ tweets, isLoading, selectedAuthor, onClearFilter }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("likeCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    return [...tweets].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [tweets, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 text-foreground" />
      : <ArrowDown className="h-3 w-3 text-foreground" />;
  };

  return (
    <Card className="bg-muted/30 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Top Posts by Engagement</CardTitle>
          {selectedAuthor && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilter}
              className="h-6 text-xs"
            >
              <X className="h-3 w-3 mr-1" />
              Clear filter
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: 'hsl(var(--table-header))' }}>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 font-medium text-muted-foreground w-[60px]">Author</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground min-w-[300px]">Tweet</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="text-right py-2 px-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none"
                    onClick={() => handleSort(col.key)}
                  >
                    <span className="flex items-center justify-end gap-1">
                      {col.label}
                      <SortIcon col={col.key} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 15 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1.5 px-2"><Skeleton className="h-4 w-12" /></td>
                      <td className="py-1.5 px-2"><Skeleton className="h-4 w-full" /></td>
                      {COLUMNS.map((col) => (
                        <td key={col.key} className="py-1.5 px-2">
                          <Skeleton className="h-4 w-10 ml-auto" />
                        </td>
                      ))}
                    </tr>
                  ))
                : sorted.map((tweet) => (
                    <tr key={tweet.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">
                        {tweet.authorName}
                      </td>
                      <td className="py-1.5 px-2 max-w-[400px]">
                        <div className="flex items-start gap-1.5">
                          {tweet.cardTitle ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs font-medium line-clamp-1">{tweet.cardTitle}</span>
                              <span className="text-[10px] text-muted-foreground line-clamp-1">{tweet.text.replace(/https?:\/\/t\.co\/\w+/g, '').trim()}</span>
                            </div>
                          ) : (
                            <span className="line-clamp-2 text-xs leading-relaxed">{tweet.text}</span>
                          )}
                          <a
                            href={tweet.cardUrl || tweet.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </td>
                      {COLUMNS.map((col) => (
                        <td key={col.key} className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
                          {col.key === "createdAt"
                            ? formatDate(tweet.createdAt)
                            : formatCount(tweet[col.key] as number)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
