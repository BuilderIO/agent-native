import { useActionQuery } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconArrowBackUp,
  IconCircleCheck,
  IconEyeOff,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { fmt, useErrorsT } from "./i18n";
import type {
  ErrorBreadcrumb,
  ErrorEventDetail,
  ErrorIssueSummary,
  IssueStatus,
  ParsedStackFrame,
} from "./types";
import {
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  levelBadgeClass,
  shortFrameFile,
  statusBadgeClass,
  useStatusLabel,
} from "./utils";

export function IssueDetail({
  issueId,
  fallback,
  onBack,
  onSetStatus,
  pendingStatus,
}: {
  issueId: string;
  fallback?: ErrorIssueSummary;
  onBack: () => void;
  onSetStatus: (status: IssueStatus) => void;
  pendingStatus: boolean;
}) {
  const t = useErrorsT();
  const statusLabel = useStatusLabel();

  const { data, isLoading, error } = useActionQuery(
    "get-error-issue",
    { id: issueId },
    { staleTime: 10_000 },
  );

  const issue = data?.issue ?? fallback ?? null;
  const events = data?.events ?? [];
  const latest = events[0];
  const replayPath =
    latest?.sessionRecordingPath ?? issue?.lastSessionRecordingPath ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconArrowLeft className="size-4" />
          {t.back}
        </button>

        {error ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">
              {fmt(t.detailLoadFailed, { message: error.message })}
            </CardContent>
          </Card>
        ) : !issue ? (
          <HeaderSkeleton />
        ) : (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                    levelBadgeClass(issue.level),
                  )}
                >
                  {issue.type}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    statusBadgeClass(issue.status),
                  )}
                >
                  {statusLabel(issue.status)}
                </span>
              </div>
              <h2 className="truncate text-lg font-semibold text-foreground">
                {issue.title}
              </h2>
              {issue.culprit ? (
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {issue.culprit}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {replayPath ? (
                <Button asChild size="sm">
                  <Link to={replayPath}>
                    <IconPlayerPlay className="size-3.5 fill-current" />
                    {t.watchReplay}
                  </Link>
                </Button>
              ) : null}
              {issue.status !== "resolved" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingStatus}
                  onClick={() => onSetStatus("resolved")}
                >
                  <IconCircleCheck className="size-3.5" />
                  {t.resolve}
                </Button>
              ) : null}
              {issue.status !== "unresolved" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingStatus}
                  onClick={() => onSetStatus("unresolved")}
                >
                  <IconArrowBackUp className="size-3.5" />
                  {t.reopen}
                </Button>
              ) : null}
              {issue.status !== "ignored" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingStatus}
                  onClick={() => onSetStatus("ignored")}
                >
                  <IconEyeOff className="size-3.5" />
                  {t.ignore}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {issue ? <OverviewGrid issue={issue} latest={latest} /> : null}
      {latest ? <LatestOccurrenceCard event={latest} /> : null}

      {isLoading && !latest ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          <StackTraceCard event={latest} />
          <BreadcrumbsCard event={latest} />
          <OccurrencesCard events={events} />
        </>
      )}
    </div>
  );
}

function hasEntries(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function JsonBlock({ value }: { value: Record<string, unknown> }) {
  return (
    <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function LatestOccurrenceCard({ event }: { event: ErrorEventDetail }) {
  const t = useErrorsT();
  const details: Array<{ label: string; value: string }> = [
    {
      label: t.occurrenceTime,
      value: formatDateTime(event.occurredAt),
    },
    {
      label: t.handled,
      value: event.handled ? t.handled : t.unhandled,
    },
  ];
  if (event.url) details.push({ label: t.url, value: event.url });

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="text-sm font-medium">{t.latestOccurrence}</div>
        {event.message ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t.message}
            </div>
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-xs text-foreground">
              {event.message}
            </p>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {details.map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {item.label}
              </div>
              <div className="mt-0.5 truncate text-sm text-foreground">
                {item.value}
              </div>
            </div>
          ))}
        </div>
        {hasEntries(event.tags) ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t.tags}
            </div>
            <JsonBlock value={event.tags} />
          </div>
        ) : null}
        {hasEntries(event.extra) ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t.additionalData}
            </div>
            <JsonBlock value={event.extra} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OverviewGrid({
  issue,
  latest,
}: {
  issue: ErrorIssueSummary;
  latest?: ErrorEventDetail;
}) {
  const t = useErrorsT();
  const items: Array<{ label: string; value: string }> = [
    { label: t.metaFirstSeen, value: formatRelativeTime(issue.firstSeenAt) },
    { label: t.metaLastSeen, value: formatRelativeTime(issue.lastSeenAt) },
    { label: t.metaEvents, value: formatNumber(issue.eventCount) },
    { label: t.metaUsers, value: formatNumber(issue.usersAffected) },
  ];
  const environment = latest?.environment;
  const release = latest?.release;
  if (environment) items.push({ label: t.metaEnvironment, value: environment });
  if (release) items.push({ label: t.metaRelease, value: release });

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {item.label}
            </div>
            <div className="mt-0.5 truncate text-sm font-medium text-foreground">
              {item.value}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StackTraceCard({ event }: { event?: ErrorEventDetail }) {
  const t = useErrorsT();
  const frames = event?.stack ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          {t.stackTrace}
        </div>
        {frames.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t.noStack}</p>
        ) : (
          <ol className="divide-y divide-border/40 font-mono text-xs">
            {frames.map((frame, index) => (
              <StackFrameRow key={index} frame={frame} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function StackFrameRow({ frame }: { frame: ParsedStackFrame }) {
  const t = useErrorsT();
  return (
    <li
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 px-4 py-2",
        frame.inApp ? "bg-transparent" : "bg-muted/20 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "font-semibold",
          frame.inApp ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {frame.function || "<anonymous>"}
      </span>
      <span className="text-muted-foreground">
        {shortFrameFile(frame.file)}
        {frame.lineno != null ? `:${frame.lineno}` : ""}
        {frame.colno != null ? `:${frame.colno}` : ""}
      </span>
      <span
        className={cn(
          "ms-auto rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
          frame.inApp
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {frame.inApp ? t.inApp : t.vendor}
      </span>
    </li>
  );
}

function normalizeBreadcrumb(value: unknown): ErrorBreadcrumb | null {
  if (typeof value === "string" && value.trim()) {
    return { message: value.trim() };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const timestamp =
    typeof record.timestamp === "string" ? record.timestamp : undefined;
  const category =
    typeof record.category === "string" ? record.category : undefined;
  const message =
    typeof record.message === "string" ? record.message : undefined;

  if (!timestamp && !category && !message) return null;
  return { timestamp, category, message };
}

function BreadcrumbsCard({ event }: { event?: ErrorEventDetail }) {
  const t = useErrorsT();
  const crumbs = (event?.breadcrumbs ?? [])
    .map(normalizeBreadcrumb)
    .filter((crumb): crumb is ErrorBreadcrumb => Boolean(crumb));

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          {t.breadcrumbs}
        </div>
        {crumbs.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t.noBreadcrumbs}</p>
        ) : (
          <ol className="divide-y divide-border/40">
            {crumbs.map((crumb, index) => (
              <li
                key={index}
                className="flex items-baseline gap-3 px-4 py-2 text-xs"
              >
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                  {crumb.category || "log"}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {crumb.message || ""}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatRelativeTime(crumb.timestamp)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function OccurrencesCard({ events }: { events: ErrorEventDetail[] }) {
  const t = useErrorsT();

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          {t.occurrences}
        </div>
        {events.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t.noOccurrences}</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs"
              >
                <span className="w-32 shrink-0 text-muted-foreground">
                  {formatDateTime(event.occurredAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {event.userKey ||
                    event.userId ||
                    event.anonymousId ||
                    t.anonymous}
                </span>
                {event.url ? (
                  <span className="hidden min-w-0 max-w-[40%] truncate font-mono text-muted-foreground md:block">
                    {event.url}
                  </span>
                ) : null}
                {event.sessionRecordingPath ? (
                  <Link
                    to={event.sessionRecordingPath}
                    className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <IconPlayerPlay className="size-3 fill-current" />
                    {t.watchReplay}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function HeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}
