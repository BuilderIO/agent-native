import { requestAgentChatThreadOpen } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconBrandGithub,
  IconBrandSlack,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import {
  AUDIT_RANGES,
  parseAuditRange,
  startedAfterForAuditRange,
  writeAuditFilterParam,
} from "@/components/factory/audit-filters";
import { SlackMrkdwn } from "@/components/factory/SlackMrkdwn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { safeHttpUrl } from "@/lib/safe-http-url";

const AUDIT_PAGE_SIZE = 20;

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
  summary: string | null;
  outcome: "held" | "dispatched" | "failed" | "inspected";
  status: string;
  rationale: string | null;
  dispatchError: string | null;
  clearBug: boolean | null;
  productUx: boolean | null;
  ownerArea: string | null;
  guards: string | null;
  events: FactoryAuditEvent[];
  userLabels?: Record<string, string>;
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

type FactoryAuditAutomationOption = {
  name: string;
  displayName: string;
};

type FactoryAuditResponse = {
  runs: FactoryAuditRun[];
  automations: FactoryAuditAutomationOption[];
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
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
  const shouldScrollOnSelectRef = useRef(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const selectedRunId = searchParams.get("auditRunId");
  const automationFilter = searchParams.get("automation") ?? "";
  const range = parseAuditRange(searchParams.get("range"));
  const startedAfter = startedAfterForAuditRange(range);
  const auditQuery = useActionQuery<FactoryAuditResponse>(
    "list-factory-audit",
    {
      factoryId,
      limit: AUDIT_PAGE_SIZE,
      ...(automationFilter ? { automation: automationFilter } : {}),
      ...(startedAfter ? { startedAfter } : {}),
      ...(cursor ? { cursor } : {}),
    },
    {
      staleTime: 5_000,
      refetchInterval: (query) =>
        query.state.data?.runs.some((run) => run.status === "running")
          ? 1_000
          : false,
    },
  );
  const configQuery = useActionQuery<{ builderSlackUserId?: string | null }>(
    "get-triage-config",
    { factoryId },
  );
  const builderSlackUserId = configQuery.data?.builderSlackUserId ?? null;
  const refetchAudit = auditQuery.refetch;
  const runs = auditQuery.data?.runs ?? [];
  const automations = auditQuery.data?.automations ?? [];
  const selectedRun = selectedRunId
    ? (runs.find((run) => run.id === selectedRunId) ?? null)
    : (runs[0] ?? null);

  useEffect(() => {
    setCursor(null);
    setCursorStack([]);
  }, [automationFilter, range]);

  useEffect(() => {
    if (selectedRunId || !selectedRun) return;
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

  function setAuditFilter(key: "automation" | "range", value: string) {
    setCursor(null);
    setCursorStack([]);
    setSearchParams(
      (current) => {
        const next = writeAuditFilterParam(current, key, value);
        next.delete("auditRunId");
        return next;
      },
      { replace: true },
    );
  }

  function selectRun(runId: string) {
    shouldScrollOnSelectRef.current = true;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("auditRunId", runId);
        return next;
      },
      { replace: true },
    );
  }

  function goToNextPage() {
    const nextCursor = auditQuery.data?.nextCursor;
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack, cursor ?? ""]);
    setCursor(nextCursor);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("auditRunId");
        return next;
      },
      { replace: true },
    );
  }

  function goToPreviousPage() {
    const stack = [...cursorStack];
    const previous = stack.pop();
    setCursorStack(stack);
    setCursor(previous ? previous : null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("auditRunId");
        return next;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    if (!shouldScrollOnSelectRef.current || !selectedRunId) return;
    shouldScrollOnSelectRef.current = false;
    viewRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selectedRunId]);

  const showPagination =
    cursorStack.length > 0 || Boolean(auditQuery.data?.hasMore);

  const runListFilters = (
    <div className="flex flex-wrap items-end gap-3">
      <AuditFilterSelect
        id="factory-audit-range-filter"
        label={t("triage.rangeLabel")}
        value={range}
        placeholder={t("triage.rangeAll")}
        options={AUDIT_RANGES.map((value) => ({
          value,
          label:
            value === "today" ? t("triage.rangeToday") : t("triage.range7d"),
        }))}
        onChange={(value) => setAuditFilter("range", value)}
      />
      <AuditFilterSelect
        id="factory-audit-automation-filter"
        label={t("factoryRoute.auditAutomationLabel")}
        value={automationFilter}
        placeholder={t("factoryRoute.auditAutomationAll")}
        options={automations.map((option) => ({
          value: option.name,
          label: option.displayName,
        }))}
        onChange={(value) => setAuditFilter("automation", value)}
      />
    </div>
  );

  return (
    <div ref={viewRef} className="p-4 lg:p-6">
      {auditQuery.isError ? (
        <Card>
          <CardContent className="flex items-start gap-2 p-4 text-sm text-destructive">
            <IconAlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{t("factoryRoute.auditLoadError")}</span>
          </CardContent>
        </Card>
      ) : (
        <div className="factory-audit-split">
          <Card className="factory-audit-run-list">
            <CardHeader className="flex flex-col items-stretch gap-3 space-y-0 px-4 py-3">
              <CardTitle className="text-sm">
                {t("factoryRoute.auditRuns")}
              </CardTitle>
              {runListFilters}
            </CardHeader>
            <CardContent className="p-0">
              {auditQuery.isLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="space-y-2">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-1/2 rounded bg-muted/70" />
                    </div>
                  ))}
                </div>
              ) : runs.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {t("factoryRoute.auditEmpty")}
                </p>
              ) : (
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
                        <div className="factory-audit-run-fields">
                          <span className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">
                            {automationLabel(run)}
                          </span>
                          <AuditStatus status={runHeadlineStatus(run)} />
                          <span className="text-xs text-muted-foreground">
                            {formatAuditAge(
                              run.startedAt,
                              t("triage.relativeNow"),
                            )}
                          </span>
                          <span className="min-w-0 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                            {formatRunHeadline(run.counts, t)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {showPagination ? (
                    <div className="flex items-center justify-between gap-2 px-1 py-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={
                          cursorStack.length === 0 || auditQuery.isFetching
                        }
                        onClick={goToPreviousPage}
                      >
                        <IconChevronLeft className="size-4" />
                        {t("triage.previousPage")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={
                          !auditQuery.data?.hasMore || auditQuery.isFetching
                        }
                        onClick={goToNextPage}
                      >
                        {t("triage.nextPage")}
                        <IconChevronRight className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          {auditQuery.isLoading ? (
            <AuditSkeleton rows={4} />
          ) : runs.length === 0 ? null : (
            <Card>
              <CardHeader className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="break-words text-base [overflow-wrap:anywhere]">
                      {selectedRun && automationLabel(selectedRun)}
                    </CardTitle>
                    {selectedRun && (
                      <div className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {formatAuditAge(
                          selectedRun.startedAt,
                          t("triage.relativeNow"),
                        )}
                        <span aria-hidden="true"> · </span>
                        {formatRunHeadline(selectedRun.counts, t)}
                      </div>
                    )}
                  </div>
                  {selectedRun && (
                    <AuditStatus status={runHeadlineStatus(selectedRun)} />
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {selectedRun && (
                  <AuditRunDetail
                    run={selectedRun}
                    factoryId={factoryId}
                    builderSlackUserId={builderSlackUserId}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function AuditRunDetail({
  run,
  factoryId,
  builderSlackUserId,
}: {
  run: FactoryAuditRun;
  factoryId: string;
  builderSlackUserId: string | null;
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
              className="mt-1 truncate text-sm text-muted-foreground"
            >
              <SlackMrkdwn
                text={item.title}
                inline
                mentionLabels={item.userLabels}
                builderSlackUserId={builderSlackUserId}
              />
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
            <AuditItemRow
              key={item.itemId}
              item={item}
              factoryId={factoryId}
              builderSlackUserId={builderSlackUserId}
            />
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
                  {formatAuditAge(step.createdAt, t("triage.relativeNow"))}
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
  builderSlackUserId,
}: {
  item: FactoryAuditItem;
  factoryId: string;
  builderSlackUserId: string | null;
}) {
  const t = useT();
  const sourceLink = resolveAuditSourceLink(item);

  return (
    <details className="group overflow-hidden rounded-lg border border-border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <AuditSourceIcon source={item.source} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            <SlackMrkdwn
              text={item.title}
              inline
              mentionLabels={item.userLabels}
              builderSlackUserId={builderSlackUserId}
            />
          </p>
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
        <AuditDecisionFacts item={item} />
        {item.summary ? (
          <div
            className={`rounded-md border border-border bg-background px-3 py-2 ${
              hasAuditFacts(item) ? "mt-3" : ""
            }`}
          >
            <SlackMrkdwn
              text={item.summary}
              mentionLabels={item.userLabels}
              builderSlackUserId={builderSlackUserId}
            />
          </div>
        ) : null}
        <div className={item.summary || hasAuditFacts(item) ? "mt-3" : ""}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {item.rationale || item.dispatchError
              ? t("factoryRoute.auditWhy")
              : t("factoryRoute.auditWhatHappened")}
          </p>
          <p className="mt-1 text-sm leading-6">
            {item.dispatchError ??
              item.rationale ??
              t("factoryRoute.auditInspectedOnly")}
          </p>
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
                    {formatAuditAge(entry.createdAt, t("triage.relativeNow"))}
                  </time>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 bg-background/40 px-3 py-3 text-xs">
          <a
            href={`/factory?factoryId=${encodeURIComponent(factoryId)}&itemId=${encodeURIComponent(item.itemId)}`}
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

function hasAuditFacts(item: FactoryAuditItem): boolean {
  return (
    item.clearBug !== null ||
    item.productUx !== null ||
    Boolean(item.ownerArea) ||
    Boolean(item.guards)
  );
}

function AuditDecisionFacts({ item }: { item: FactoryAuditItem }) {
  const t = useT();
  if (!hasAuditFacts(item)) {
    return null;
  }

  return (
    <div className="flex flex-wrap content-start gap-x-3 gap-y-1 text-xs text-muted-foreground">
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

function AuditFilterSelect({
  id,
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="h-8 w-44 rounded-md border border-input bg-card px-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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
  const stored = safeHttpUrl(item.sourceUrl);
  if (stored) return stored;
  for (const event of item.events) {
    const channelId = readStringDetail(event.details, "channelId");
    const threadTs = readStringDetail(event.details, "threadTs");
    if (channelId && threadTs) {
      return safeHttpUrl(slackThreadUrl(channelId, threadTs));
    }
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

function formatAuditAge(value: string | number, nowLabel: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1_000),
  );
  if (elapsedSeconds < 60) return nowLabel;
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
