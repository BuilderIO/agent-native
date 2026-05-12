import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
} from "@tabler/icons-react";
import type { SentryIssue } from "./index";

interface ErrorGroup {
  type: string;
  issues: SentryIssue[];
  totalEvents: number;
  totalUsers: number;
  worstLevel: string;
}

function levelOrder(level: string): number {
  return { fatal: 0, error: 1, warning: 2, info: 3, debug: 4 }[level] ?? 5;
}

function levelColor(level: string): string {
  switch (level) {
    case "fatal":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800";
    case "error":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800";
    case "warning":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function timeAgo(date: string): string {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function GroupRow({ group }: { group: ErrorGroup }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        type="button"
        className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex items-start gap-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge
              className={`text-[10px] px-1.5 py-0 ${levelColor(group.worstLevel)} border`}
            >
              {group.worstLevel}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {group.issues.length} issue{group.issues.length !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-sm font-medium mt-1 truncate">{group.type}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">
            {formatCount(group.totalEvents)}
          </p>
          <p className="text-xs text-muted-foreground">events</p>
        </div>
        <div className="shrink-0 pt-0.5">
          {expanded ? (
            <IconChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <IconChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="bg-muted/20 border-t border-border/50">
          {group.issues.map((issue) => (
            <a
              key={issue.id}
              href={issue.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 px-6 py-2.5 hover:bg-muted/50 transition-colors group"
            >
              <Badge
                className={`text-[10px] px-1.5 py-0 shrink-0 mt-0.5 ${levelColor(issue.level)} border`}
              >
                {issue.level}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">
                  {issue.metadata.value ?? issue.title}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {issue.project.name} · {timeAgo(issue.lastSeen)} ·{" "}
                  {formatCount(parseInt(issue.count, 10))} events
                </p>
              </div>
              <IconExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface ErrorGroupsPanelProps {
  issues: SentryIssue[];
  isLoading: boolean;
}

export function ErrorGroupsPanel({ issues, isLoading }: ErrorGroupsPanelProps) {
  const groups = useMemo((): ErrorGroup[] => {
    const map = new Map<string, SentryIssue[]>();
    for (const issue of issues) {
      const type = issue.metadata.type ?? issue.type ?? "Unknown";
      const arr = map.get(type) ?? [];
      arr.push(issue);
      map.set(type, arr);
    }
    return [...map.entries()]
      .map(([type, issueList]) => {
        const totalEvents = issueList.reduce(
          (s, i) => s + parseInt(i.count, 10),
          0,
        );
        const totalUsers = issueList.reduce((s, i) => s + i.userCount, 0);
        const worstLevel = issueList.reduce((worst, i) => {
          return levelOrder(i.level) < levelOrder(worst) ? i.level : worst;
        }, "debug");
        return { type, issues: issueList, totalEvents, totalUsers, worstLevel };
      })
      .sort((a, b) => b.totalEvents - a.totalEvents);
  }, [issues]);

  if (isLoading) {
    return (
      <div className="divide-y divide-border/50">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Skeleton className="h-6 w-10 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">No error groups found</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[520px]">
      <div>
        {groups.map((group) => (
          <GroupRow key={group.type} group={group} />
        ))}
      </div>
    </ScrollArea>
  );
}
