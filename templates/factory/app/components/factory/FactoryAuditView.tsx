import { requestAgentChatThreadOpen } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconBrandGithub,
  IconBrandSlack,
  IconChevronDown,
  IconExternalLink,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FactoryAuditCounts = {
  newlyObserved: number;
  scanned: number;
  investigated: number;
  held: number;
  dispatched: number;
  failed: number;
};

type FactoryAuditEvent = {
  id: string;
  itemId: string | null;
  source: string | null;
  sourceUrl: string | null;
  action: string;
  kind: string;
  status: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
};

type FactoryAuditItem = {
  itemId: string;
  source: string | null;
  sourceUrl: string | null;
  title: string;
  outcome: "held" | "dispatched" | "failed" | "inspected";
  status: string;
  rationale: string | null;
  dispatchError: string | null;
  clearBug: boolean | null;
  productUx: boolean | null;
  ownerArea: string | null;
  guards: string | null;
  events: FactoryAuditEvent[];
};

type FactoryAuditTraceStep = {
  id: string;
  action: string;
  summary: string;
  status: string;
  createdAt: string;
  count: number;
  purpose: string | null;
};

type FactoryAuditRun = {
  id: string;
  automation: string;
  displayName: string | null;
  runId: string | null;
  threadId: string | null;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  counts: FactoryAuditCounts;
  items: FactoryAuditItem[];
  trace: FactoryAuditTraceStep[];
};

type FactoryAuditResponse = {
  runs: FactoryAuditRun[];
  count: number;
};

export function FactoryAuditView({
  factoryId,
  refreshToken = 0,
}: {
  factoryId: string;
  refreshToken?: number;
}) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewRef = useRef<HTMLDivElement>(null);
  const selectedRunId = searchParams.get("auditRunId");
  const auditQuery = useActionQuery<FactoryAuditResponse>(
    "list-factory-audit",
    { factoryId, limit: 30 },
    {
      staleTime: 5_000,
      refetchInterval: (query) =>
        query.state.data?.runs.some((run) => run.status === "running")
          ? 1_000
          : false,
    },
  );
  const refetchAudit = auditQuery.refetch;
  const runs = auditQuery.data?.runs ?? [];
  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  useEffect(() => {
    if (!selectedRun || selectedRun.id === selectedRunId) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("auditRunId", selectedRun.id);
        return next;
      },
      { replace: true },
    );
  }, [selectedRun, selectedRunId, setSearchParams]);

  useEffect(() => {
    if (refreshToken === 0) return;
    void refetchAudit();
  }, [refreshToken, refetchAudit]);

  function selectRun(runId: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("auditRunId", runId);
        return next;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    if (!selectedRunId) return;
    viewRef.current?.scrollIntoView({ block: "start" });
  }, [selectedRunId]);

  return (
    <div ref={viewRef} className="p-4 lg:p-6">
      {auditQuery.isError ? (
        <Card>
          <CardContent className="flex items-start gap-2 p-4 text-sm text-destructive">
            <IconAlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{t("factoryRoute.auditLoadError")}</span>
          </CardContent>
        </Card>
      ) : auditQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,.4fr)_minmax(0,1fr)]">
          <AuditSkeleton rows={5} />
          <AuditSkeleton rows={4} />
        </div>
      ) : runs.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {t("factoryRoute.auditEmpty")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,.4fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">
                {t("factoryRoute.auditRuns")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid gap-1.5 p-2">
                {runs.map((run) => {
                  const selected = selectedRun?.id === run.id;
                  return (
                    <button
                      key={run.id}
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      className={`w-full cursor-pointer rounded-lg p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        selected
                          ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                          : "bg-muted/20 hover:bg-muted/50"
                      }`}
                      onClick={() => selectRun(run.id)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium">
                          {automationLabel(run)}
                        </span>
                        <AuditStatus status={runHeadlineStatus(run)} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0">
                          {formatAuditAge(run.startedAt)}
                        </span>
                        <span className="min-w-0 truncate">
                          {formatRunHeadline(run.counts, t)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">
                    {selectedRun && automationLabel(selectedRun)}
                  </CardTitle>
                  {selectedRun && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {formatAuditAge(selectedRun.startedAt)}
                      <span aria-hidden="true"> · </span>
                      {formatRunHeadline(selectedRun.counts, t)}
                    </p>
                  )}
                </div>
                {selectedRun && (
                  <AuditStatus status={runHeadlineStatus(selectedRun)} />
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {selectedRun && (
                <AuditRunDetail run={selectedRun} factoryId={factoryId} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function AuditRunDetail({
  run,
  factoryId,
}: {
  run: FactoryAuditRun;
  factoryId: string;
}) {
  const t = useT();
  const items = run.items ?? [];
  const trace = run.trace ?? [];
  const failedItems = items.filter((item) => item.outcome === "failed");

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {run.threadId && (
          <a
            href={`/chat/${encodeURIComponent(run.threadId)}`}
            className="inline-flex items-center text-primary hover:underline"
            onClick={(event) => {
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.button !== 0
              ) {
                return;
              }
              event.preventDefault();
              requestAgentChatThreadOpen({ threadId: run.threadId! });
            }}
          >
            {t("factoryRoute.auditOpenThread")}
          </a>
        )}
      </div>

      {(run.error || failedItems.length > 0) && (
        <div className="mt-4 rounded-md bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">
            {t("factoryRoute.auditRunError")}
          </p>
          {run.error ? (
            <p className="mt-1 break-words text-muted-foreground">
              {run.error}
            </p>
          ) : null}
          {failedItems.map((item) => (
            <p
              key={item.itemId}
              className="mt-1 break-words text-muted-foreground"
            >
              {item.title}
              {item.dispatchError ? ` — ${item.dispatchError}` : ""}
            </p>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-1.5">
        {items.length === 0 ? (
          <p className="rounded-md bg-muted/20 p-4 text-sm text-muted-foreground">
            {t("factoryRoute.auditNoEvents")}
          </p>
        ) : (
          items.map((item) => (
            <AuditItemRow key={item.itemId} item={item} factoryId={factoryId} />
          ))
        )}
      </div>

      {trace.length > 0 && (
        <details className="group mt-5 overflow-hidden rounded-lg border border-border bg-muted/20">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>{t("factoryRoute.auditTrace")}</span>
            <IconChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[var(--ease-collapse)] group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="space-y-2 px-4 pb-4">
            {trace.map((step) => (
              <div
                key={step.id}
                className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
              >
                <span className="min-w-0 truncate">{step.summary}</span>
                <time className="shrink-0">
                  {formatAuditAge(step.createdAt)}
                </time>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function AuditItemRow({
  item,
  factoryId,
}: {
  item: FactoryAuditItem;
  factoryId: string;
}) {
  const t = useT();
  const sourceLink = resolveAuditSourceLink(item);

  return (
    <details className="group overflow-hidden rounded-lg border border-border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <AuditSourceIcon source={item.source} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatItemOutcome(item.outcome, t)}
          </p>
        </div>
        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
          {formatAuditSource(item.source)}
        </span>
        <AuditStatus status={item.status} compact />
        <IconChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[var(--ease-collapse)] group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="bg-muted/20 px-4 pb-4 pt-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {item.rationale || item.dispatchError
                ? t("factoryRoute.auditWhy")
                : t("factoryRoute.auditWhatHappened")}
            </p>
            <p className="mt-1 max-w-[72ch] text-sm leading-6">
              {item.dispatchError ??
                item.rationale ??
                t("factoryRoute.auditInspectedOnly")}
            </p>
          </div>
          <AuditDecisionFacts item={item} />
        </div>

        {item.events.length > 0 && (
          <div className="mt-4 rounded-md bg-background/40 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("factoryRoute.auditTrace")}
            </p>
            <div className="mt-2 space-y-2">
              {item.events.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <AuditStatus status={entry.status} compact />
                    <span className="truncate">
                      {formatAuditAction(entry.action)}
                    </span>
                  </span>
                  <time className="shrink-0">
                    {formatAuditAge(entry.createdAt)}
                  </time>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 bg-background/40 px-3 py-3 text-xs">
          <a
            href={`/factory?factoryId=${encodeURIComponent(factoryId)}&tab=inbox&itemId=${encodeURIComponent(item.itemId)}`}
            className="text-primary hover:underline"
          >
            {t("factoryRoute.auditOpenItem")}
          </a>
          {sourceLink && (
            <a
              href={sourceLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {t("factoryRoute.auditOpenSource")}
              <IconExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    </details>
  );
}

function AuditDecisionFacts({ item }: { item: FactoryAuditItem }) {
  const t = useT();
  if (
    item.clearBug === null &&
    item.productUx === null &&
    !item.ownerArea &&
    !item.guards
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap content-start gap-x-3 gap-y-1 text-xs text-muted-foreground sm:max-w-[260px] sm:justify-end">
      {item.clearBug !== null && (
        <AuditFact
          label={t("factoryRoute.auditClearBug")}
          value={yesNo(item.clearBug)}
        />
      )}
      {item.productUx !== null && (
        <AuditFact
          label={t("factoryRoute.auditUxImpact")}
          value={yesNo(item.productUx)}
        />
      )}
      {item.ownerArea && (
        <AuditFact
          label={t("factoryRoute.auditOwnerArea")}
          value={item.ownerArea}
        />
      )}
      {item.guards && (
        <AuditFact
          label={t("factoryRoute.auditGuardsLabel")}
          value={item.guards}
        />
      )}
    </div>
  );
}

function AuditFact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-medium text-foreground">{label}</span> {value}
    </span>
  );
}

function AuditSourceIcon({ source }: { source: string | null }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("slack"))
    return <IconBrandSlack className={className} />;
  if (normalized.includes("github"))
    return <IconBrandGithub className={className} />;
  if (normalized.includes("sentry"))
    return <IconAlertCircle className={className} />;
  return <IconSearch className={className} />;
}

function AuditStatus({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  const tone =
    status === "success"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-destructive"
        : status === "skipped"
          ? "bg-muted-foreground"
          : "bg-amber-500";
  const label = formatAuditLabel(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground ${compact ? "" : "capitalize"}`}
      aria-label={label}
      title={label}
    >
      <span className={`size-1.5 rounded-full ${tone}`} />
      {!compact && label}
    </span>
  );
}

function AuditSkeleton({ rows }: { rows: number }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted/70" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function runHeadlineStatus(run: FactoryAuditRun): string {
  if (run.status === "error" || (run.counts?.failed ?? 0) > 0) return "error";
  if (run.status === "running") return "running";
  if ((run.counts?.held ?? 0) > 0 && (run.counts?.dispatched ?? 0) === 0) {
    return "skipped";
  }
  return run.status;
}

function formatRunHeadline(
  counts: FactoryAuditCounts | undefined,
  t: ReturnType<typeof useT>,
): string {
  if (!counts) return "";
  const parts: string[] = [];
  if (counts.newlyObserved > 0) {
    parts.push(
      t("factoryRoute.auditObserved", { count: counts.newlyObserved }),
    );
  } else {
    parts.push(t("factoryRoute.auditNoNew"));
  }
  if (counts.scanned > 0 && counts.scanned !== counts.newlyObserved) {
    parts.push(t("factoryRoute.auditScanned", { count: counts.scanned }));
  }
  if (counts.failed > 0) {
    parts.push(t("factoryRoute.auditFailed", { count: counts.failed }));
  }
  if (counts.dispatched > 0) {
    parts.push(t("factoryRoute.auditDispatched", { count: counts.dispatched }));
  }
  if (counts.held > 0) {
    parts.push(t("factoryRoute.auditHeld", { count: counts.held }));
  }
  return parts.join(" · ");
}

function formatItemOutcome(
  outcome: FactoryAuditItem["outcome"],
  t: ReturnType<typeof useT>,
): string {
  if (outcome === "failed") return t("factoryRoute.auditOutcomeFailed");
  if (outcome === "dispatched") return t("factoryRoute.auditOutcomeDispatched");
  if (outcome === "held") return t("factoryRoute.auditOutcomeHeld");
  return t("factoryRoute.auditOutcomeInspected");
}

function formatAuditSource(source: string | null): string {
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("slack")) return "Slack";
  if (normalized.includes("github")) return "GitHub";
  if (normalized.includes("sentry")) return "Sentry";
  return source ? formatAuditLabel(source) : "Factory";
}

function resolveAuditSourceLink(item: FactoryAuditItem): string | null {
  if (item.sourceUrl) return item.sourceUrl;
  for (const event of item.events) {
    const channelId = readStringDetail(event.details, "channelId");
    const threadTs = readStringDetail(event.details, "threadTs");
    if (channelId && threadTs) return slackThreadUrl(channelId, threadTs);
  }
  return null;
}

function slackThreadUrl(channelId: string, threadTs: string): string {
  const compactTs = threadTs.replace(".", "");
  return `https://slack.com/archives/${encodeURIComponent(channelId)}/p${compactTs}?thread_ts=${encodeURIComponent(threadTs)}`;
}

function automationLabel(run: FactoryAuditRun): string {
  if (run.displayName) return run.displayName;
  const segments = run.automation.split("/");
  return formatAutomationName(segments[segments.length - 1] || run.automation);
}

function formatAutomationName(value: string): string {
  const words = value
    .replace(/^factory-/, "")
    .replace(/[_-]+/g, " ")
    .split(" ");
  return words
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "github") return "GitHub";
      if (lower === "slack") return "Slack";
      if (lower === "sentry") return "Sentry";
      if (lower === "pr") return "PR";
      return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function formatAuditAction(value: string): string {
  return formatAuditLabel(value).replace(/^Poll /, "Check ");
}

function formatAuditAge(value: string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1_000),
  );
  if (elapsedSeconds < 60) return "now";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) return `${elapsedDays}d`;
  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${elapsedMonths}mo`;
  return `${Math.floor(elapsedMonths / 12)}y`;
}

function formatAuditLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readStringDetail(
  details: Record<string, unknown>,
  key: string,
): string | null {
  return typeof details[key] === "string" && details[key] ? details[key] : null;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
