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
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FactoryAuditEvent = {
  id: string;
  automationRunId: string | null;
  automationThreadId: string | null;
  automationName: string | null;
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

type FactoryAuditRun = {
  id: string;
  automation: string;
  runId: string | null;
  threadId: string | null;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  events: FactoryAuditEvent[];
};

type FactoryAuditResponse = {
  runs: FactoryAuditRun[];
  count: number;
};

type AuditItemGroup = {
  key: string;
  events: FactoryAuditEvent[];
  itemId: string | null;
  source: string | null;
  sourceUrl: string | null;
  title: string;
  outcome: string;
  status: string;
  latestAt: string;
  checks: number;
  decision: FactoryAuditEvent | null;
  externalAction: FactoryAuditEvent | null;
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
  const selectedRunId = searchParams.get("auditRunId");
  const auditQuery = useActionQuery<FactoryAuditResponse>(
    "list-factory-audit",
    { factoryId, limit: 30 },
    { staleTime: 5_000 },
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

  return (
    <div className="p-4 lg:p-6">
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
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm">
                  {t("factoryRoute.auditRuns")}
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {runs.length}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className={`w-full cursor-pointer p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedRun?.id === run.id ? "bg-muted/60" : ""}`}
                    onClick={() => selectRun(run.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {formatAutomationName(run.automation)}
                      </span>
                      <AuditStatus status={run.status} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">
                        {formatAuditAge(run.startedAt)}
                      </span>
                      <span className="shrink-0">
                        {run.events.length}{" "}
                        {formatAuditCountLabel(run.events.length)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">
                    {selectedRun &&
                      formatAutomationName(selectedRun.automation)}
                  </CardTitle>
                  {selectedRun && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {formatAuditAge(selectedRun.startedAt)}
                    </p>
                  )}
                </div>
                {selectedRun && <AuditStatus status={selectedRun.status} />}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {selectedRun && <AuditRunDetail run={selectedRun} />}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function AuditRunDetail({ run }: { run: FactoryAuditRun }) {
  const t = useT();
  const groups = useMemo(() => groupAuditEvents(run.events), [run.events]);
  const itemCount = new Set(
    run.events
      .map((event) => event.itemId)
      .filter((itemId): itemId is string => Boolean(itemId)),
  ).size;
  const decisionCount = run.events.filter(
    (event) => event.kind === "decision",
  ).length;
  const actionCount = run.events.filter(
    (event) => event.kind === "external_action",
  ).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
        <span>
          {decisionCount} {decisionCount === 1 ? "decision" : "decisions"}
        </span>
        <span>
          {actionCount} {actionCount === 1 ? "action" : "actions"}
        </span>
        {run.threadId && (
          <a
            href={`/chat/${encodeURIComponent(run.threadId)}`}
            className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
          >
            {t("factoryRoute.auditOpenThread")}
            <IconExternalLink className="size-3" />
          </a>
        )}
      </div>

      {run.error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">
            {t("factoryRoute.auditRunError")}
          </p>
          <p className="mt-1 break-words text-muted-foreground">{run.error}</p>
        </div>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Activity</h3>
          <span className="text-xs text-muted-foreground">
            {groups.length} {groups.length === 1 ? "thing" : "things"}
          </span>
        </div>
        {groups.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {t("factoryRoute.auditNoEvents")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            {groups.map((group) => (
              <AuditItemRow key={group.key} group={group} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AuditItemRow({ group }: { group: AuditItemGroup }) {
  const t = useT();
  const decision = group.decision;
  const rationale = decision?.summary ?? group.externalAction?.summary ?? null;
  const sourceLink =
    group.sourceUrl ?? group.events.find((event) => event.sourceUrl)?.sourceUrl;

  return (
    <details className="group border-b last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <AuditSourceIcon source={group.source} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{group.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {group.outcome}
            <span aria-hidden="true"> · </span>
            {group.checks} {formatAuditCountLabel(group.checks)}
          </p>
        </div>
        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
          {formatAuditSource(group.source)}
        </span>
        <AuditStatus status={group.status} compact />
        <IconChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[var(--ease-collapse)] group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t bg-muted/20 px-4 pb-4 pt-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {rationale ? "Why" : "What happened"}
            </p>
            <p className="mt-1 max-w-[72ch] text-sm leading-6">
              {rationale ??
                "The source was inspected, but no action was taken."}
            </p>
          </div>
          <AuditDecisionFacts event={decision} />
        </div>

        <div className="mt-4 border-t border-border/70 pt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Trace
          </p>
          <div className="mt-2 space-y-2">
            {group.events.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <AuditStatus status={event.status} compact />
                  <span className="truncate">
                    {formatAuditAction(event.action)}
                  </span>
                </span>
                <time className="shrink-0">
                  {formatAuditAge(event.createdAt)}
                </time>
              </div>
            ))}
          </div>
        </div>

        {(group.itemId || sourceLink) && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-xs">
            {group.itemId && (
              <a
                href={`/factory?tab=inbox&itemId=${encodeURIComponent(group.itemId)}`}
                className="text-primary hover:underline"
              >
                {t("factoryRoute.auditOpenItem")}
              </a>
            )}
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
        )}
      </div>
    </details>
  );
}

function AuditDecisionFacts({ event }: { event: FactoryAuditEvent | null }) {
  const t = useT();
  if (!event) return null;
  const clearBug = readBooleanDetail(event.details, "clearBug");
  const productUx = readBooleanDetail(event.details, "productUxImplications");
  const ownerArea = readStringDetail(event.details, "ownerOwnedArea");
  const guards = readGuardSummary(event.details.guardResults);
  if (clearBug === null && productUx === null && !ownerArea && !guards)
    return null;

  return (
    <div className="flex flex-wrap content-start gap-x-3 gap-y-1 text-xs text-muted-foreground sm:max-w-[260px] sm:justify-end">
      {clearBug !== null && (
        <AuditFact
          label={t("factoryRoute.auditClearBug")}
          value={yesNo(clearBug)}
        />
      )}
      {productUx !== null && (
        <AuditFact
          label={t("factoryRoute.auditUxImpact")}
          value={yesNo(productUx)}
        />
      )}
      {ownerArea && (
        <AuditFact label={t("factoryRoute.auditOwnerArea")} value={ownerArea} />
      )}
      {guards && <AuditFact label="Guards" value={guards} />}
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

function groupAuditEvents(events: FactoryAuditEvent[]): AuditItemGroup[] {
  const grouped = new Map<string, FactoryAuditEvent[]>();
  for (const event of events) {
    const key = event.itemId ?? `event:${event.id}`;
    const current = grouped.get(key) ?? [];
    current.push(event);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, groupEvents]) => {
      const decision =
        groupEvents.find((event) => event.kind === "decision") ?? null;
      const externalAction =
        groupEvents.find((event) => event.kind === "external_action") ?? null;
      const titleEvent =
        groupEvents.find((event) => event.action === "get-triage-item") ??
        groupEvents.find(
          (event) => event.action === "get-slack-feedback-context",
        ) ??
        groupEvents.find((event) => event.action === "list-triage-items") ??
        groupEvents.find((event) => event.kind === "observed") ??
        groupEvents[0];
      const latestAt = groupEvents.reduce(
        (latest, event) =>
          new Date(event.createdAt).getTime() > new Date(latest).getTime()
            ? event.createdAt
            : latest,
        groupEvents[0].createdAt,
      );

      return {
        key,
        events: groupEvents,
        itemId: titleEvent.itemId,
        source: titleEvent.source,
        sourceUrl: titleEvent.sourceUrl,
        title: formatAuditSubject(titleEvent),
        outcome: formatAuditOutcome(groupEvents, decision, externalAction),
        status: formatGroupStatus(groupEvents, decision, externalAction),
        latestAt,
        checks: groupEvents.filter(
          (event) => event.kind === "read" || event.kind === "observed",
        ).length,
        decision,
        externalAction,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime(),
    );
}

function formatAuditSubject(event: FactoryAuditEvent): string {
  if (event.action === "get-slack-feedback-context") {
    const messageCount = readNumberDetail(event.details, "messageCount");
    return `Slack thread${messageCount === null ? "" : ` · ${messageCount} ${messageCount === 1 ? "message" : "messages"}`}`;
  }
  const summary = event.summary.trim();
  const subject = summary.replace(/^(Inspected|Read)\s+/i, "");
  return truncateAuditText(subject || formatAuditAction(event.action), 110);
}

function formatAuditOutcome(
  events: FactoryAuditEvent[],
  decision: FactoryAuditEvent | null,
  externalAction: FactoryAuditEvent | null,
): string {
  if (externalAction) {
    const provider = readStringDetail(externalAction.details, "provider");
    if (provider === "bot-tag") return "Builder tagged in Slack";
    if (provider === "builder-http") return "Builder fix submitted";
    return "Action taken";
  }
  if (decision) {
    const ownerArea = readStringDetail(decision.details, "ownerOwnedArea");
    const productUx = readBooleanDetail(
      decision.details,
      "productUxImplications",
    );
    if (decision.status === "skipped" || ownerArea || productUx === true) {
      return "Held for review";
    }
    if (readBooleanDetail(decision.details, "clearBug") === true) {
      return "Builder fix selected";
    }
    return "Decision recorded";
  }
  if (
    events.some(
      (event) =>
        event.kind === "observed" && /no new|no result/i.test(event.summary),
    )
  ) {
    return "No new items";
  }
  return "Inspected only";
}

function formatGroupStatus(
  events: FactoryAuditEvent[],
  decision: FactoryAuditEvent | null,
  externalAction: FactoryAuditEvent | null,
): string {
  if (events.some((event) => event.status === "error")) return "error";
  if (externalAction) return externalAction.status;
  if (decision) return decision.status;
  return events.some((event) => event.status === "running")
    ? "running"
    : "success";
}

function formatAuditSource(source: string | null): string {
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("slack")) return "Slack";
  if (normalized.includes("github")) return "GitHub";
  if (normalized.includes("sentry")) return "Sentry";
  return source ? formatAuditLabel(source) : "Factory";
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

function formatAuditCountLabel(value: number): string {
  return value === 1 ? "check" : "checks";
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

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "unreadable";
  }
}

function truncateAuditText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function readBooleanDetail(
  details: Record<string, unknown>,
  key: string,
): boolean | null {
  return typeof details[key] === "boolean" ? details[key] : null;
}

function readNumberDetail(
  details: Record<string, unknown>,
  key: string,
): number | null {
  return typeof details[key] === "number" ? details[key] : null;
}

function readStringDetail(
  details: Record<string, unknown>,
  key: string,
): string | null {
  return typeof details[key] === "string" && details[key] ? details[key] : null;
}

function readGuardSummary(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const passed = value.filter(
    (guard): guard is { passed: boolean } =>
      typeof guard === "object" &&
      guard !== null &&
      "passed" in guard &&
      typeof guard.passed === "boolean" &&
      guard.passed,
  ).length;
  return `${passed}/${value.length} passed`;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
