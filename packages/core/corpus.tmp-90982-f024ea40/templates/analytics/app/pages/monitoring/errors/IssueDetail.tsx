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

const DEFAULT_FREQUENCY_DAYS = 14;

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
      {issue ? <FrequencyCard issue={issue} /> : null}

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
          {latest ? <LatestOccurrenceCard event={latest} /> : null}
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

function FrequencyCard({ issue }: { issue: ErrorIssueSummary }) {
  const t = useErrorsT();
  const values = (
    issue.sparkline?.length
      ? issue.sparkline
      : new Array(DEFAULT_FREQUENCY_DAYS).fill(0)
  ).map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const dayLabels = buildFrequencyDayLabels(values.length);
  const barClass = frequencyBarClass(issue.level);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{t.frequency}</div>
            <div className="text-xs text-muted-foreground">
              {fmt(t.frequencyWindow, { days: values.length })}
            </div>
          </div>
          <div className="text-end">
            <div className="text-sm font-semibold text-foreground">
              {formatNumber(total)}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t.recentOccurrences}
            </div>
          </div>
        </div>

        <div className="flex h-28 items-end gap-1 border-b border-border/60 pb-2">
          {values.map((count, index) => {
            const height = count === 0 ? 4 : Math.max(12, (count / max) * 100);
            const label = fmt(t.frequencyBarLabel, {
              count,
              date: dayLabels[index]?.long ?? "",
            });
            return (
              <div
                key={`${dayLabels[index]?.iso ?? index}-${index}`}
                className="flex h-full flex-1 items-end"
                title={label}
                aria-label={label}
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm transition-colors",
                    count > 0 ? barClass : "bg-muted-foreground/15",
                  )}
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{dayLabels[0]?.short}</span>
          {total === 0 ? <span>{t.noRecentVolume}</span> : null}
          <span>{dayLabels[dayLabels.length - 1]?.short}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function frequencyBarClass(level: ErrorIssueSummary["level"]): string {
  switch (level) {
    case "fatal":
      return "bg-red-500/85 hover:bg-red-400";
    case "error":
      return "bg-rose-500/85 hover:bg-rose-400";
    case "warning":
      return "bg-amber-400/85 hover:bg-amber-300";
    case "info":
      return "bg-sky-400/85 hover:bg-sky-300";
    case "debug":
    default:
      return "bg-violet-400/75 hover:bg-violet-300";
  }
}

function buildFrequencyDayLabels(days: number): Array<{
  iso: string;
  short: string;
  long: string;
}> {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  return Array.from({ length: Math.max(1, days) }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1 - index));
    return {
      iso: date.toISOString().slice(0, 10),
      short: formatter.format(date),
      long: formatter.format(date),
    };
  });
}

function StackTraceCard({ event }: { event?: ErrorEventDetail }) {
  const t = useErrorsT();
  const frames = event?.stack ?? [];
  const rawStack = event?.rawStack?.trim() ?? "";
  const headline =
    rawStack.split("\n")[0]?.trim() ||
    (event ? `${event.type}: ${event.message}` : "");

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <div className="text-sm font-medium">{t.stackTrace}</div>
            {headline ? (
              <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {headline}
              </div>
            ) : null}
          </div>
          {frames.length > 0 ? (
            <span className="rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {fmt(t.stackFrameCount, { count: frames.length })}
            </span>
          ) : null}
        </div>
        {frames.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t.noStack}</p>
        ) : (
          <ol className="divide-y divide-border/40">
            {frames.map((frame, index) => (
              <StackFrameRow key={index} frame={frame} index={index} />
            ))}
          </ol>
        )}
        {rawStack ? (
          <details className="border-t px-4 py-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              {t.rawStack}
            </summary>
            <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground">
              {rawStack}
            </pre>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StackFrameRow({
  frame,
  index,
}: {
  frame: ParsedStackFrame;
  index: number;
}) {
  const t = useErrorsT();
  const location = stackFrameLocation(frame);

  return (
    <li
      className={cn(
        "grid gap-3 px-4 py-3 sm:grid-cols-[auto_1fr_auto]",
        frame.inApp ? "bg-background" : "bg-muted/20 text-muted-foreground",
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/35 font-mono text-[11px] text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-xs">
          <span
            className={cn(
              "font-semibold",
              frame.inApp ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {frame.function || "<anonymous>"}
          </span>
          <span className="min-w-0 truncate text-muted-foreground">
            {location}
          </span>
        </div>
        {frame.raw ? (
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted/25 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {frame.raw}
          </pre>
        ) : null}
        {frame.sourceContext?.length ? (
          <SourceContextBlock lines={frame.sourceContext} />
        ) : null}
      </div>
      <span
        className={cn(
          "h-fit rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide sm:justify-self-end",
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

function SourceContextBlock({
  lines,
}: {
  lines: NonNullable<ParsedStackFrame["sourceContext"]>;
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-md bg-muted/20">
      <div className="overflow-x-auto font-mono text-[11px] leading-relaxed">
        {lines.map((line) => (
          <div
            key={line.line}
            className={cn(
              "grid min-w-max grid-cols-[3rem_1fr]",
              line.highlight
                ? "bg-rose-500/10 text-foreground"
                : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "select-none px-2 py-0.5 text-end",
                line.highlight ? "text-rose-300" : "text-muted-foreground/70",
              )}
            >
              {line.line}
            </span>
            <code className="whitespace-pre px-3 py-0.5">
              <HighlightedSourceLine text={line.text || " "} />
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

type SourceTokenKind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "literal"
  | "function"
  | "operator"
  | "plain";

const JS_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "of",
  "return",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "while",
]);

const JS_LITERALS = new Set(["false", "null", "true", "undefined"]);

function HighlightedSourceLine({ text }: { text: string }) {
  return (
    <>
      {tokenizeSourceLine(text).map((token, index) => (
        <span
          key={`${index}-${token.text}`}
          className={sourceTokenClass(token.kind)}
        >
          {token.text}
        </span>
      ))}
    </>
  );
}

function tokenizeSourceLine(
  text: string,
): Array<{ text: string; kind: SourceTokenKind }> {
  const tokens: Array<{ text: string; kind: SourceTokenKind }> = [];
  let index = 0;

  const push = (value: string, kind: SourceTokenKind) => {
    if (value) tokens.push({ text: value, kind });
  };

  while (index < text.length) {
    const rest = text.slice(index);

    if (rest.startsWith("//")) {
      push(rest, "comment");
      break;
    }

    const quote = text[index];
    if (quote === '"' || quote === "'" || quote === "`") {
      let end = index + 1;
      let escaped = false;
      while (end < text.length) {
        const char = text[end];
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      push(text.slice(index, end), "string");
      index = end;
      continue;
    }

    const number = rest.match(/^\b\d+(?:\.\d+)?\b/);
    if (number) {
      push(number[0], "number");
      index += number[0].length;
      continue;
    }

    const word = rest.match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const value = word[0];
      const after = text.slice(index + value.length);
      const kind: SourceTokenKind = JS_KEYWORDS.has(value)
        ? "keyword"
        : JS_LITERALS.has(value)
          ? "literal"
          : /^\s*\(/.test(after)
            ? "function"
            : "plain";
      push(value, kind);
      index += value.length;
      continue;
    }

    const operator = rest.match(/^[{}()[\].,;:?=+\-*/!<>|&%]+/);
    if (operator) {
      push(operator[0], "operator");
      index += operator[0].length;
      continue;
    }

    push(text[index], "plain");
    index += 1;
  }

  return tokens.length ? tokens : [{ text: " ", kind: "plain" }];
}

function sourceTokenClass(kind: SourceTokenKind): string {
  switch (kind) {
    case "keyword":
      return "text-fuchsia-300";
    case "string":
      return "text-emerald-300";
    case "number":
      return "text-amber-300";
    case "comment":
      return "text-muted-foreground/65 italic";
    case "literal":
      return "text-orange-300";
    case "function":
      return "text-sky-300";
    case "operator":
      return "text-muted-foreground";
    case "plain":
    default:
      return "";
  }
}

function stackFrameLocation(frame: ParsedStackFrame): string {
  return [
    shortFrameFile(frame.file),
    frame.lineno != null ? frame.lineno : null,
    frame.colno != null ? frame.colno : null,
  ]
    .filter((part) => part !== null && part !== "")
    .join(":");
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
