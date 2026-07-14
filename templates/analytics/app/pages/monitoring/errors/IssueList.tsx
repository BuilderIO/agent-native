import { CodeSurface } from "@agent-native/core/blocks";
import {
  IconAlertTriangle,
  IconBug,
  IconCode,
  IconExternalLink,
  IconRefresh,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { fmt, useErrorsT } from "./i18n";
import { Sparkline } from "./Sparkline";
import type { ErrorIssueSummary, StatusFilter } from "./types";
import {
  formatNumber,
  formatRelativeTime,
  levelAccentClass,
  levelBadgeClass,
  statusBadgeClass,
  useLevelLabel,
  useStatusLabel,
} from "./utils";

const ERROR_CAPTURE_DOCS_URL =
  "https://www.agent-native.com/docs/tracking#error-capture";

const ERROR_CAPTURE_SNIPPET = `// Agent Native templates already call configureTracking().
import { configureTracking, captureException } from "@agent-native/core/client";

configureTracking({
  key: "anpk_...",
  endpoint: "https://analytics.example.com/api/analytics/track",
  // Auto-captures window.onerror + unhandledrejection and links each
  // error to the session replay it happened in. On by default when a
  // public key is set; pass errorCapture: false to opt out.
  errorCapture: true,
});

// Manual, Sentry-style capture anywhere in your app:
try {
  risky();
} catch (err) {
  captureException(err, { tags: { area: "checkout" } });
}`;

const STATUS_TABS: StatusFilter[] = [
  "unresolved",
  "resolved",
  "ignored",
  "all",
];

export function IssueList({
  issues,
  isLoading,
  status,
  onStatusChange,
  search,
  onSearchChange,
  onRefresh,
  isFetching,
  onSelect,
  onSendTestError,
  sendingTest,
  error,
}: {
  issues: ErrorIssueSummary[];
  isLoading: boolean;
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  isFetching: boolean;
  onSelect: (id: string) => void;
  onSendTestError: () => void;
  sendingTest: boolean;
  error?: string | null;
}) {
  const t = useErrorsT();

  const tabLabel = (tab: StatusFilter): string => {
    switch (tab) {
      case "unresolved":
        return t.tabUnresolved;
      case "resolved":
        return t.tabResolved;
      case "ignored":
        return t.tabIgnored;
      default:
        return t.tabAll;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex rounded-lg border border-border/60 bg-muted/20 p-0.5"
          role="tablist"
        >
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={status === tab}
              onClick={() => onStatusChange(tab)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative sm:w-64">
            <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="ps-8"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            aria-label={t.refresh}
          >
            <IconRefresh
              className={cn("size-3.5", isFetching && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            {fmt(t.loadFailed, { message: error })}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <IssueListSkeleton />
      ) : issues.length === 0 ? (
        <EmptyState
          filtered={status !== "unresolved" || search.trim().length > 0}
          onSendTestError={onSendTestError}
          sendingTest={sendingTest}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border/60">
              {issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} onSelect={onSelect} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  onSelect,
}: {
  issue: ErrorIssueSummary;
  onSelect: (id: string) => void;
}) {
  const t = useErrorsT();
  const levelLabel = useLevelLabel();
  const statusLabel = useStatusLabel();

  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => onSelect(issue.id)}
        className="flex w-full items-center gap-4 py-3 pe-4 ps-5 text-left transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none"
      >
        <span
          className={cn(
            "absolute inset-y-2 start-0 w-1 rounded-full",
            levelAccentClass(issue.level),
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                levelBadgeClass(issue.level),
              )}
            >
              {issue.type}
            </span>
            <span className="truncate text-sm font-semibold text-foreground">
              {stripTypePrefix(issue.title, issue.type)}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {issue.culprit ? (
              <span className="truncate font-mono">{issue.culprit}</span>
            ) : null}
            {issue.app ? <span>· {issue.app}</span> : null}
            <span>
              ·{" "}
              {fmt(t.lastSeen, { time: formatRelativeTime(issue.lastSeenAt) })}
            </span>
          </span>
        </span>

        <Sparkline
          data={issue.sparkline}
          className="hidden shrink-0 sm:block"
        />

        <span className="hidden w-16 shrink-0 flex-col items-end md:flex">
          <span className="text-sm font-semibold text-foreground">
            {formatNumber(issue.eventCount)}
          </span>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t.events}
          </span>
        </span>
        <span className="hidden w-16 shrink-0 flex-col items-end lg:flex">
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
            <IconUsers className="size-3.5 text-muted-foreground" />
            {formatNumber(issue.usersAffected)}
          </span>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t.users}
          </span>
        </span>

        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
            statusBadgeClass(issue.status),
          )}
        >
          {statusLabel(issue.status)}
        </span>
        {levelLabel(issue.level) ? (
          <span className="sr-only">{levelLabel(issue.level)}</span>
        ) : null}
      </button>
    </li>
  );
}

function EmptyState({
  filtered,
  onSendTestError,
  sendingTest,
}: {
  filtered: boolean;
  onSendTestError: () => void;
  sendingTest: boolean;
}) {
  const t = useErrorsT();

  if (filtered) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <IconAlertTriangle className="size-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{t.emptySearch}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="grid gap-6 p-6 lg:grid-cols-2 lg:p-8">
        <div className="flex flex-col justify-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border bg-muted/40">
            <IconAlertTriangle className="size-5 text-primary" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">{t.emptyTitle}</h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              {t.emptyDescription}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" onClick={onSendTestError} disabled={sendingTest}>
              <IconBug className="size-3.5" />
              {sendingTest ? t.sending : t.sendTestError}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={ERROR_CAPTURE_DOCS_URL} target="_blank" rel="noreferrer">
                {t.docs}
                <IconExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-md border bg-muted/30">
          <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
            <IconCode className="size-4 text-muted-foreground" />
            <span className="truncate">{t.installTitle}</span>
          </div>
          <CodeSurface
            code={ERROR_CAPTURE_SNIPPET}
            language="typescript"
            maxLines={null}
            showLanguageLabel={false}
            className="mt-0"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function IssueListSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

/** Issue titles are "Type: message"; the type is shown as a badge already. */
function stripTypePrefix(title: string, type: string): string {
  const prefix = `${type}: `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}
