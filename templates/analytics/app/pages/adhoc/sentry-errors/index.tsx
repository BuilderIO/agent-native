import { useState, useMemo } from "react";
import { useActionQuery, sendToAgentChat } from "@agent-native/core/client";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  IconBug,
  IconUsers,
  IconAlertTriangle,
  IconTrendingUp,
  IconChevronRight,
  IconChevronDown,
  IconExternalLink,
  IconRefresh,
  IconClock,
  IconCopy,
  IconCircleCheck,
  IconLink,
  IconSparkles,
  IconFilter,
} from "@tabler/icons-react";
import { IssueSparkline } from "./IssueSparkline";
import { ErrorGroupsPanel } from "./ErrorGroupsPanel";
import { SlackMentionsPanel } from "./SlackMentionsPanel";
import { GitHubBlamePanel } from "./GitHubBlamePanel";
import {
  classifyIssue,
  classificationLabel,
  classificationColor,
  type IssueClass,
} from "./issueClassifier";

// ---- Types ------------------------------------------------------------------

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  level: "fatal" | "error" | "warning" | "info" | "debug";
  status: string;
  platform: string;
  project: { id: string; name: string; slug: string };
  type: string;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  stats?: Record<string, number[][]>;
}

interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
}

type StatsPeriod = "24h" | "7d" | "14d" | "30d";

// ---- Helpers ----------------------------------------------------------------

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

function isEscalating(issue: SentryIssue): boolean {
  const stats = issue.stats?.["24h"];
  if (!stats || stats.length < 4) return false;
  const recent = stats.slice(-4).reduce((s, [, v]) => s + v, 0);
  const earlier = stats.slice(-8, -4).reduce((s, [, v]) => s + v, 0);
  return recent > earlier * 1.5 && recent > 0;
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

// ---- Sub-components ---------------------------------------------------------

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  isLoading,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
  isLoading?: boolean;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            {isLoading ? (
              <Skeleton className="h-7 w-20 mt-1" />
            ) : (
              <p className={`text-2xl font-bold mt-0.5 ${accent ?? ""}`}>
                {value}
              </p>
            )}
          </div>
          <div className="ml-3 p-2 rounded-lg bg-muted/50 shrink-0">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IssueRow({
  issue,
  rank,
  isSelected,
  escalating,
  onSelect,
}: {
  issue: SentryIssue;
  rank: number;
  isSelected: boolean;
  escalating: boolean;
  onSelect: () => void;
}) {
  const count = parseInt(issue.count, 10);
  const { classification, reason } = classifyIssue(issue);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors ${
        isSelected ? "bg-muted/60" : ""
      } ${classification === "noise" || classification === "user-error" ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xs text-muted-foreground w-5 pt-0.5 shrink-0 font-mono">
          {rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              className={`text-[10px] px-1.5 py-0 ${levelColor(issue.level)} border`}
            >
              {issue.level}
            </Badge>
            {escalating && (
              <Badge className="text-[10px] px-1.5 py-0 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border border-rose-200 dark:border-rose-800 gap-0.5">
                <IconTrendingUp className="h-2.5 w-2.5" />
                escalating
              </Badge>
            )}
            {classification !== "unknown" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    className={`text-[10px] px-1.5 py-0 border cursor-default ${classificationColor(classification)}`}
                  >
                    {classificationLabel(classification)}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  {reason}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="text-xs text-muted-foreground font-mono">
              {issue.project.name}
            </span>
          </div>
          <p className="text-sm font-medium mt-1 truncate leading-snug">
            {issue.metadata.type ?? issue.title}
          </p>
          {issue.metadata.value && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {issue.metadata.value}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right min-w-[60px]">
          <p className="text-sm font-semibold tabular-nums">
            {formatCount(count)}
          </p>
          <p className="text-xs text-muted-foreground">
            {issue.userCount > 0 ? `${issue.userCount} users` : ""}
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          {isSelected ? (
            <IconChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <IconChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Sparkline */}
      {issue.stats?.["24h"] && (
        <div className="ml-8 mt-2">
          <IssueSparkline data={issue.stats["24h"]} escalating={escalating} />
        </div>
      )}
    </button>
  );
}

function IssueDetail({ issue }: { issue: SentryIssue }) {
  const count = parseInt(issue.count, 10);
  return (
    <div className="bg-muted/30 border-b border-border/50 px-4 py-4 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Total events</p>
          <p className="text-sm font-semibold mt-0.5">{formatCount(count)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Affected users</p>
          <p className="text-sm font-semibold mt-0.5">{issue.userCount}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">First seen</p>
          <p className="text-sm font-semibold mt-0.5">
            {timeAgo(issue.firstSeen)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Last seen</p>
          <p className="text-sm font-semibold mt-0.5">
            {timeAgo(issue.lastSeen)}
          </p>
        </div>
      </div>

      {issue.culprit && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Culprit</p>
          <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all">
            {issue.culprit}
          </code>
        </div>
      )}

      {issue.metadata.filename && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Location</p>
          <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all">
            {issue.metadata.filename}
            {issue.metadata.function && ` · ${issue.metadata.function}`}
          </code>
        </div>
      )}

      <div className="flex items-center gap-2">
        <a
          href={issue.permalink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
          Open in Sentry
        </a>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-xs text-muted-foreground font-mono">
          {issue.shortId}
        </span>
      </div>

      <GitHubBlamePanel issue={issue} />
      <SlackMentionsPanel issue={issue} />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <div className="p-3 rounded-full bg-muted/60 mb-4">
        <IconCircleCheck className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <div className="p-3 rounded-full bg-muted/60 mb-4">
        <IconAlertTriangle className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium mb-1">Could not load Sentry data</p>
      <p className="text-xs text-muted-foreground max-w-sm">{message}</p>
      <p className="text-xs text-muted-foreground mt-2">
        Check <span className="font-medium">Settings → Data sources</span> and
        ensure <span className="font-mono">SENTRY_AUTH_TOKEN</span> is
        configured.
      </p>
    </div>
  );
}

function IssueListSkeleton() {
  return (
    <div className="divide-y divide-border/50">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex gap-3">
          <Skeleton className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ---- Main Component ---------------------------------------------------------

export default function SentryErrorsDashboard() {
  const [period, setPeriod] = useState<StatsPeriod>("7d");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"top10" | "escalating" | "groups">(
    "top10",
  );
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
    new Set(),
  );

  const issuesQuery = useActionQuery("sentry", {
    mode: "issues",
    statsPeriod: period,
    query: "is:unresolved",
  });

  const statsQuery = useActionQuery("sentry", {
    mode: "stats",
    statsPeriod: period,
  });

  const rawData = issuesQuery.data as
    | { issues?: SentryIssue[] }
    | { error: string; message?: string }
    | null;

  // Action returns 200 with { error: "missing_api_key", message: "..." } when
  // credentials aren't configured — treat it the same as a fetch error.
  const dataError: string | null = useMemo(() => {
    if (issuesQuery.error) return (issuesQuery.error as Error).message;
    if (rawData && "error" in rawData) {
      return (
        (rawData as { message?: string }).message ??
        String((rawData as { error: string }).error)
      );
    }
    return null;
  }, [issuesQuery.error, rawData]);

  const allIssues: SentryIssue[] = useMemo(
    () => (rawData && "issues" in rawData ? (rawData.issues ?? []) : []),
    [rawData],
  );

  const allProjects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const issue of allIssues) {
      if (!seen.has(issue.project.slug)) {
        seen.set(issue.project.slug, issue.project.name);
      }
    }
    return Array.from(seen.entries()).map(([slug, name]) => ({ slug, name }));
  }, [allIssues]);

  const issues: SentryIssue[] = useMemo(
    () =>
      selectedProjects.size === 0
        ? allIssues
        : allIssues.filter((i) => selectedProjects.has(i.project.slug)),
    [allIssues, selectedProjects],
  );

  function toggleProject(slug: string) {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    setSelectedIssueId(null);
  }

  const top10 = useMemo(
    () =>
      [...issues]
        .sort((a, b) => parseInt(b.count, 10) - parseInt(a.count, 10))
        .slice(0, 10),
    [issues],
  );

  const escalating = useMemo(
    () => issues.filter(isEscalating).slice(0, 10),
    [issues],
  );

  const totalEvents = useMemo(
    () => issues.reduce((s, i) => s + parseInt(i.count, 10), 0),
    [issues],
  );

  const totalUsers = useMemo(
    () => issues.reduce((s, i) => s + i.userCount, 0),
    [issues],
  );

  const displayedIssues =
    activeTab === "top10"
      ? top10
      : activeTab === "escalating"
        ? escalating
        : [];

  const isLoading = issuesQuery.isLoading;
  const error = dataError;

  const classifications = useMemo(
    () => issues.map((i) => ({ id: i.id, ...classifyIssue(i) })),
    [issues],
  );

  const actionableCount = classifications.filter(
    (c) => c.classification === "actionable",
  ).length;
  const noiseCount = classifications.filter(
    (c) => c.classification === "noise" || c.classification === "user-error",
  ).length;

  function handleClassifyWithAI() {
    const sample = top10
      .map((issue, i) => {
        const { classification, reason } = classifyIssue(issue);
        return `${i + 1}. [${issue.shortId}] ${issue.metadata.type ?? issue.title}${
          issue.metadata.value ? `: ${issue.metadata.value.slice(0, 80)}` : ""
        } — ${issue.count} events, ${issue.userCount} users, culprit: ${issue.culprit} (heuristic: ${classification}, ${reason})`;
      })
      .join("\n");
    sendToAgentChat({
      message: `Please analyze these top Sentry errors and classify each one as: "actionable" (real bug we should fix), "user-error" (expected from bad user input/auth), or "noise" (transient/third-party/not worth fixing). For each, briefly explain why and suggest what to do.\n\n${sample}`,
      submit: true,
    });
  }

  function toggleIssue(id: string) {
    setSelectedIssueId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <IconBug className="h-5 w-5 text-muted-foreground" />
            Sentry Error Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Top errors, escalating issues, and related error groups
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            value={period}
            onValueChange={(v) => setPeriod(v as StatsPeriod)}
          >
            <TabsList className="h-8">
              <TabsTrigger value="24h" className="text-xs px-2.5">
                24h
              </TabsTrigger>
              <TabsTrigger value="7d" className="text-xs px-2.5">
                7d
              </TabsTrigger>
              <TabsTrigger value="14d" className="text-xs px-2.5">
                14d
              </TabsTrigger>
              <TabsTrigger value="30d" className="text-xs px-2.5">
                30d
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => issuesQuery.refetch()}
            disabled={isLoading}
          >
            <IconRefresh
              className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Unresolved Issues"
          value={formatCount(issues.length)}
          icon={IconBug}
          isLoading={isLoading}
        />
        <StatCard
          label="Total Events"
          value={formatCount(totalEvents)}
          icon={IconAlertTriangle}
          accent="text-orange-600 dark:text-orange-400"
          isLoading={isLoading}
        />
        <StatCard
          label="Affected Users"
          value={formatCount(totalUsers)}
          icon={IconUsers}
          isLoading={isLoading}
        />
        <StatCard
          label="Escalating"
          value={escalating.length}
          icon={IconTrendingUp}
          accent={
            escalating.length > 0
              ? "text-rose-600 dark:text-rose-400"
              : undefined
          }
          isLoading={isLoading}
        />
      </div>

      {/* Project Filter */}
      {!isLoading && allProjects.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">
            Projects:
          </span>
          {allProjects.map(({ slug, name }) => {
            const active = selectedProjects.has(slug);
            return (
              <button
                key={slug}
                type="button"
                onClick={() => toggleProject(slug)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {name}
              </button>
            );
          })}
          {selectedProjects.size > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedProjects(new Set());
                setSelectedIssueId(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Classification Summary */}
      {!isLoading && !error && issues.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border/50 bg-muted/20 flex-wrap">
          <div className="flex items-center gap-4 text-sm flex-wrap">
            <span className="text-muted-foreground text-xs">
              Heuristic classification:
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
              <span className="text-xs font-medium">
                {actionableCount} actionable
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
              <span className="text-xs font-medium">
                {noiseCount} noise / user error
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0" />
              <span className="text-xs font-medium">
                {issues.length - actionableCount - noiseCount} unclassified
              </span>
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs shrink-0"
            onClick={handleClassifyWithAI}
          >
            <IconSparkles className="h-3.5 w-3.5" />
            Classify top 10 with AI
          </Button>
        </div>
      )}

      {/* Main Content */}
      {error ? (
        <Card className="border-border/50">
          <ErrorState message={error} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Issue List */}
          <Card className="lg:col-span-2 border-border/50 overflow-hidden">
            <CardHeader className="pb-0 pt-4 px-4">
              <Tabs
                value={activeTab}
                onValueChange={(v) =>
                  setActiveTab(v as "top10" | "escalating" | "groups")
                }
              >
                <TabsList className="h-8">
                  <TabsTrigger value="top10" className="text-xs px-3">
                    Top 10 Errors
                  </TabsTrigger>
                  <TabsTrigger
                    value="escalating"
                    className="text-xs px-3 gap-1.5"
                  >
                    <IconTrendingUp className="h-3 w-3" />
                    Escalating
                    {escalating.length > 0 && !isLoading && (
                      <span className="ml-0.5 rounded-full bg-rose-500 text-white text-[9px] w-4 h-4 flex items-center justify-center font-bold">
                        {escalating.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="groups" className="text-xs px-3">
                    Error Groups
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>

            <div className="mt-3">
              {activeTab === "groups" ? (
                <ErrorGroupsPanel issues={issues} isLoading={isLoading} />
              ) : isLoading ? (
                <IssueListSkeleton />
              ) : displayedIssues.length === 0 ? (
                <EmptyState
                  message={
                    activeTab === "escalating"
                      ? "No escalating errors detected in this period."
                      : "No issues found."
                  }
                />
              ) : (
                <ScrollArea className="h-[520px]">
                  <div>
                    {displayedIssues.map((issue, i) => {
                      const escalating_ = isEscalating(issue);
                      return (
                        <div key={issue.id}>
                          <IssueRow
                            issue={issue}
                            rank={i + 1}
                            isSelected={selectedIssueId === issue.id}
                            escalating={escalating_}
                            onSelect={() => toggleIssue(issue.id)}
                          />
                          {selectedIssueId === issue.id && (
                            <IssueDetail issue={issue} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          </Card>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Related Issues panel */}
            <RelatedIssuesPanel
              issues={issues}
              selectedIssue={
                selectedIssueId
                  ? (issues.find((i) => i.id === selectedIssueId) ?? null)
                  : null
              }
              isLoading={isLoading}
            />

            {/* Project Breakdown */}
            <ProjectBreakdownPanel issues={issues} isLoading={isLoading} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Related Issues Panel ---------------------------------------------------

function RelatedIssuesPanel({
  issues,
  selectedIssue,
  isLoading,
}: {
  issues: SentryIssue[];
  selectedIssue: SentryIssue | null;
  isLoading: boolean;
}) {
  const related = useMemo(() => {
    if (!selectedIssue) return [];
    const selectedType = selectedIssue.metadata.type ?? "";
    const selectedCulprit = selectedIssue.culprit;
    return issues
      .filter(
        (i) =>
          i.id !== selectedIssue.id &&
          (i.culprit === selectedCulprit ||
            (selectedType && i.metadata.type === selectedType)),
      )
      .slice(0, 5);
  }, [issues, selectedIssue]);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <IconLink className="h-4 w-4 text-muted-foreground" />
          Related Issues
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !selectedIssue ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Select an issue to see related errors
          </p>
        ) : related.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No related issues found
          </p>
        ) : (
          <div className="space-y-2">
            {related.map((issue) => (
              <a
                key={issue.id}
                href={issue.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-2.5 rounded-lg border border-border/60 hover:border-border hover:bg-muted/40 transition-colors text-left"
              >
                <div className="flex items-start gap-2">
                  <Badge
                    className={`text-[10px] px-1.5 py-0 shrink-0 mt-0.5 ${levelColor(issue.level)} border`}
                  >
                    {issue.level}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate leading-snug">
                      {issue.metadata.type ?? issue.title}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <IconClock className="h-2.5 w-2.5" />
                      {timeAgo(issue.lastSeen)} ·{" "}
                      {formatCount(parseInt(issue.count, 10))} events
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Project Breakdown Panel ------------------------------------------------

function ProjectBreakdownPanel({
  issues,
  isLoading,
}: {
  issues: SentryIssue[];
  isLoading: boolean;
}) {
  const projectCounts = useMemo(() => {
    const map = new Map<
      string,
      { name: string; count: number; events: number }
    >();
    for (const issue of issues) {
      const key = issue.project.slug;
      const existing = map.get(key) ?? {
        name: issue.project.name,
        count: 0,
        events: 0,
      };
      map.set(key, {
        name: issue.project.name,
        count: existing.count + 1,
        events: existing.events + parseInt(issue.count, 10),
      });
    }
    return [...map.values()].sort((a, b) => b.events - a.events).slice(0, 6);
  }, [issues]);

  const maxEvents = projectCounts[0]?.events ?? 1;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <IconCopy className="h-4 w-4 text-muted-foreground" />
          By Project
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2.5">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : projectCounts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No projects
          </p>
        ) : (
          projectCounts.map((proj) => (
            <div key={proj.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs truncate font-medium">
                  {proj.name}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-2">
                  {formatCount(proj.events)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-orange-500/70"
                  style={{ width: `${(proj.events / maxEvents) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
