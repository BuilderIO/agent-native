import { useState, useMemo } from "react";
import type { SentryIssue } from "./types";
import { Sparkline } from "./Sparkline";

const LEVEL_COLORS: Record<string, string> = {
  fatal: "bg-red-600 text-white",
  error: "bg-red-500/20 text-red-400",
  warning: "bg-amber-500/20 text-amber-400",
  info: "bg-blue-500/20 text-blue-400",
  debug: "bg-gray-500/20 text-gray-400",
};

const LEVEL_GRAPH_COLORS: Record<string, string> = {
  fatal: "#dc2626",
  error: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
  debug: "#6b7280",
};

type SortField = "count" | "userCount" | "lastSeen" | "firstSeen" | "level";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 15;

interface Props {
  issues: SentryIssue[] | undefined;
  isLoading: boolean;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Generate a fake sparkline from issue metadata (count spread over time) */
function issueSparklineData(issue: SentryIssue): number[] {
  const count = parseInt(issue.count);
  const firstSeen = new Date(issue.firstSeen).getTime();
  const lastSeen = new Date(issue.lastSeen).getTime();
  const span = lastSeen - firstSeen;
  const points = 12;
  const data: number[] = [];

  // Use a deterministic pseudo-random based on issue id
  let seed = 0;
  for (let i = 0; i < issue.id.length; i++) {
    seed = ((seed << 5) - seed + issue.id.charCodeAt(i)) | 0;
  }

  for (let i = 0; i < points; i++) {
    seed = (seed * 16807 + 0) % 2147483647;
    const noise = (seed % 100) / 100;
    // Weight towards recent activity
    const recency = (i / points) ** 1.5;
    const val = Math.max(
      0,
      Math.round((count * (noise * 0.3 + recency * 0.1)) / points),
    );
    data.push(val);
  }

  // Make sure last point reflects the count magnitude
  if (span < 3600000) {
    // Active in last hour — spike at end
    data[points - 1] = Math.round(count * 0.4);
    data[points - 2] = Math.round(count * 0.25);
  }

  return data;
}

export function IssuesTable({ issues, isLoading }: Props) {
  const [sortField, setSortField] = useState<SortField>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!issues) return [];
    return [...issues].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "count":
          cmp = parseInt(a.count) - parseInt(b.count);
          break;
        case "userCount":
          cmp = a.userCount - b.userCount;
          break;
        case "lastSeen":
          cmp = new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
          break;
        case "firstSeen":
          cmp =
            new Date(a.firstSeen).getTime() - new Date(b.firstSeen).getTime();
          break;
        case "level": {
          const order = { fatal: 4, error: 3, warning: 2, info: 1, debug: 0 };
          cmp =
            (order[a.level as keyof typeof order] ?? 0) -
            (order[b.level as keyof typeof order] ?? 0);
          break;
        }
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [issues, sortField, sortDir]);

  // Reset page when data changes
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(0);
  }

  function SortHeader({
    field,
    label,
    className,
  }: {
    field: SortField;
    label: string;
    className?: string;
  }) {
    const active = sortField === field;
    return (
      <th
        onClick={() => toggleSort(field)}
        className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none ${className ?? ""}`}
      >
        {label}
        {active && (
          <span className="ml-1">
            {sortDir === "desc" ? "\u2193" : "\u2191"}
          </span>
        )}
      </th>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm text-muted-foreground animate-pulse">
          Loading issues...
        </div>
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm text-muted-foreground">No issues found</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-[40%]">
                Issue
              </th>
              <SortHeader field="level" label="Level" />
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Graph
              </th>
              <SortHeader field="count" label="Events" className="text-right" />
              <SortHeader
                field="userCount"
                label="Users"
                className="text-right"
              />
              <SortHeader field="firstSeen" label="First Seen" />
              <SortHeader field="lastSeen" label="Last Seen" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paged.map((issue) => (
              <tr
                key={issue.id}
                className="hover:bg-muted/20 transition-colors"
              >
                <td className="px-3 py-2.5">
                  <a
                    href={issue.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground hover:text-primary font-medium line-clamp-1"
                  >
                    {issue.title}
                  </a>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground/70">
                      {issue.project.name}
                    </span>
                    {issue.culprit && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {issue.culprit}
                        </span>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${LEVEL_COLORS[issue.level] ?? LEVEL_COLORS.debug}`}
                  >
                    {issue.level}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <Sparkline
                    data={issueSparklineData(issue)}
                    color={LEVEL_GRAPH_COLORS[issue.level] ?? "#6b7280"}
                    width={80}
                    height={24}
                  />
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">
                  {formatCount(parseInt(issue.count))}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">
                  {formatCount(issue.userCount)}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                  {timeAgo(issue.firstSeen)}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                  {timeAgo(issue.lastSeen)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Showing {safePage * PAGE_SIZE + 1}–
            {Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of{" "}
            {sorted.length} issues
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={safePage === 0}
              className="px-2 py-1 text-xs rounded border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              First
            </button>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-2 py-1 text-xs rounded border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="px-2 text-xs text-muted-foreground">
              {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-2 py-1 text-xs rounded border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={safePage >= totalPages - 1}
              className="px-2 py-1 text-xs rounded border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
