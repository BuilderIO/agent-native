import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconBrandGithub,
  IconBrandSlack,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconLoader2,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { SlackMrkdwn } from "@/components/factory/SlackMrkdwn";
import {
  TriageRiskPill,
  TriageStatusPill,
} from "@/components/triage/triage-status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INBOX_PAGE_SIZE = 50;
const INBOX_STATUSES = [
  "received",
  "context_fetching",
  "evidence_ready",
  "classified",
  "shadow_decided",
  "needs_manual",
  "failed",
  "reconciliation_required",
  "automation_started",
  "pr_observed",
  "auto_approved",
  "merged",
] as const;

const inboxListColumns =
  "w-full gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(4.75rem,auto)_minmax(7.5rem,auto)_minmax(4.5rem,auto)] sm:items-start";

type InboxStatus = (typeof INBOX_STATUSES)[number];
type Verdict = "correct" | "incorrect" | "uncertain";

type InboxListItem = {
  id?: string;
  itemId?: string;
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  risk?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  reason?: string | null;
};

type InboxDecision = {
  decisionId: string;
  summary?: string | null;
  reason?: string | null;
  outcome?: string | null;
  createdAt?: string | null;
};

type InboxEvent = {
  id: string;
  action: string;
  kind: string;
  status: string;
  summary: string;
  createdAt: string;
};

type InboxRun = {
  id?: string;
  status?: string | null;
  provider?: string | null;
  error?: string | null;
  startedAt?: string | null;
};

type InboxDetail = InboxListItem & {
  decisions?: InboxDecision[] | null;
  events?: InboxEvent[] | null;
  runs?: InboxRun[] | null;
};

type InboxListResponse = {
  items: InboxListItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

type SlackThreadResponse = {
  coverage?: "complete" | "partial";
  sourceUrl?: string | null;
  messages?: Array<{
    user?: string | null;
    username?: string | null;
    botId?: string | null;
    text?: string | null;
    ts?: string | null;
  }>;
};

export function FactoryInboxView({ factoryId }: { factoryId: string }) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<InboxStatus | "">("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("itemId"),
  );
  const [feedbackNote, setFeedbackNote] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const listQuery = useActionQuery<InboxListResponse>("list-triage-items", {
    factoryId,
    limit: INBOX_PAGE_SIZE,
    ...(status ? { status } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const items = listQuery.data?.items ?? [];
  const selectedListItem =
    items.find((item) => inboxItemId(item) === selectedId) ?? null;
  const detailQuery = useActionQuery<InboxDetail>(
    "get-triage-item",
    selectedId ? { factoryId, itemId: selectedId } : undefined,
    { enabled: Boolean(selectedId) },
  );
  const selectedItem = detailQuery.data;
  const selectedSource = selectedListItem?.source ?? selectedItem?.source;
  const slackQuery = useActionQuery<SlackThreadResponse>(
    "get-slack-feedback-context",
    selectedId && isSlackSource(selectedSource)
      ? { factoryId, itemId: selectedId }
      : undefined,
    {
      enabled: Boolean(selectedId && isSlackSource(selectedSource)),
    },
  );
  const feedbackMutation = useActionMutation("record-triage-feedback");
  const approveMutation = useActionMutation("approve-factory-item");

  useEffect(() => {
    setSelectedId(searchParams.get("itemId"));
  }, [searchParams]);

  useEffect(() => {
    if (!selectedId) return;
    selectedRowRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedId, items.length]);

  function selectItem(itemId: string) {
    setSelectedId(itemId);
    setVerdict(null);
    setFeedbackNote("");
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("itemId", itemId);
        return next;
      },
      { replace: true },
    );
  }

  function goToNextPage() {
    const nextCursor = listQuery.data?.nextCursor;
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack, cursor ?? ""]);
    setCursor(nextCursor);
  }

  function goToPreviousPage() {
    const stack = [...cursorStack];
    const previous = stack.pop();
    setCursorStack(stack);
    setCursor(previous ? previous : null);
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.4fr)] lg:p-6">
      <Card>
        <CardHeader className="flex flex-row items-end justify-between gap-3 space-y-0">
          <div className="grid gap-1.5">
            <Label htmlFor="factory-status-filter">{t("triage.status")}</Label>
            <select
              id="factory-status-filter"
              className="h-8 w-44 rounded-md border border-input bg-card px-2 text-sm"
              value={status}
              onChange={(event) => {
                const value = event.target.value;
                setStatus(
                  INBOX_STATUSES.includes(value as InboxStatus)
                    ? (value as InboxStatus)
                    : "",
                );
                setCursor(null);
                setCursorStack([]);
              }}
            >
              <option value="">{t("triage.statusPlaceholder")}</option>
              {INBOX_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            {listQuery.isFetching && <IconLoader2 className="animate-spin" />}
            {t("triage.refresh")}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {listQuery.isError ? (
            <p className="p-4 text-sm text-destructive">
              {t("triage.queueError")}
            </p>
          ) : listQuery.isLoading ? (
            <InboxListSkeleton />
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {t("triage.empty")}
            </p>
          ) : (
            <div className="grid gap-1.5 p-2">
              <div
                className={`hidden px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground sm:grid ${inboxListColumns}`}
              >
                <span />
                <span>{t("triage.risk")}</span>
                <span>{t("triage.status")}</span>
                <span>{t("triage.updatedAt")}</span>
              </div>
              {items.map((item) => {
                const id = inboxItemId(item);
                const selected = selectedId === id;
                const snippet = inboxSnippet(item);
                const updatedAge = formatInboxAge(item.updatedAt);
                return (
                  <button
                    key={id}
                    ref={selected ? selectedRowRef : undefined}
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    className={`grid rounded-lg px-4 py-3 text-left transition-colors ${inboxListColumns} ${
                      selected
                        ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                        : "bg-muted/20 hover:bg-muted/50"
                    }`}
                    onClick={() => selectItem(id)}
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                        {formatInboxSource(item.source ?? item.sourceName)}
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-medium">
                        {snippet}
                      </span>
                    </span>
                    <span>
                      <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground sm:hidden">
                        {t("triage.risk")}
                      </span>
                      <TriageRiskPill risk={item.risk} />
                    </span>
                    <span>
                      <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground sm:hidden">
                        {t("triage.status")}
                      </span>
                      <TriageStatusPill status={item.status} />
                    </span>
                    <span>
                      <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground sm:hidden">
                        {t("triage.updatedAt")}
                      </span>
                      {updatedAge && item.updatedAt ? (
                        <time
                          className="text-sm tabular-nums text-muted-foreground"
                          dateTime={item.updatedAt}
                        >
                          {updatedAge}
                        </time>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </span>
                  </button>
                );
              })}
              <div className="flex items-center justify-between gap-2 px-2 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={cursorStack.length === 0 || listQuery.isFetching}
                  onClick={goToPreviousPage}
                >
                  <IconChevronLeft className="size-4" />
                  {t("triage.previousPage")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!listQuery.data?.hasMore || listQuery.isFetching}
                  onClick={goToNextPage}
                >
                  {t("triage.nextPage")}
                  <IconChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          {!selectedId ? (
            <p className="text-sm text-muted-foreground">
              {t("factoryRoute.selectObservation")}
            </p>
          ) : detailQuery.isError ? (
            <p className="text-sm text-destructive">
              {t("triage.detailError")}
            </p>
          ) : detailQuery.isLoading || !selectedItem ? (
            <InboxDetailSkeleton />
          ) : (
            <InboxDetailPane
              factoryId={factoryId}
              item={selectedItem}
              listItem={selectedListItem}
              slackQuery={slackQuery}
              t={t}
              verdict={verdict}
              setVerdict={setVerdict}
              feedbackNote={feedbackNote}
              setFeedbackNote={setFeedbackNote}
              approveMutation={approveMutation}
              feedbackMutation={feedbackMutation}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InboxDetailPane({
  factoryId,
  item,
  listItem,
  slackQuery,
  t,
  verdict,
  setVerdict,
  feedbackNote,
  setFeedbackNote,
  approveMutation,
  feedbackMutation,
}: {
  factoryId: string;
  item: InboxDetail;
  listItem: InboxListItem | null;
  slackQuery: ReturnType<typeof useActionQuery<SlackThreadResponse>>;
  t: ReturnType<typeof useT>;
  verdict: Verdict | null;
  setVerdict: (value: Verdict) => void;
  feedbackNote: string;
  setFeedbackNote: (value: string) => void;
  approveMutation: {
    mutate: (input: {
      factoryId: string;
      itemId: string;
      decisionId: string;
      confirm: true;
    }) => void;
    isPending: boolean;
  };
  feedbackMutation: {
    mutate: (input: {
      factoryId: string;
      decisionId: string;
      verdict: Verdict;
      note?: string;
    }) => void;
    isPending: boolean;
  };
}) {
  const source = item.source ?? listItem?.source ?? item.sourceName;
  const reason =
    item.decisions?.[item.decisions.length - 1]?.reason ??
    item.decisions?.[item.decisions.length - 1]?.summary ??
    listItem?.reason ??
    null;
  const latestDecision = item.decisions?.[item.decisions.length - 1];
  const events = item.events ?? [];
  const runs = item.runs ?? [];

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {formatInboxSource(source)}
          </p>
          <p className="truncate text-sm font-medium">
            {inboxSnippet(item) || inboxSnippet(listItem)}
          </p>
          {(item.sourceUrl || listItem?.sourceUrl) && (
            <a
              href={item.sourceUrl ?? listItem?.sourceUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t("triage.openSource")}
              <IconExternalLink className="size-3" />
            </a>
          )}
        </div>
        <TriageStatusPill status={item.status ?? listItem?.status} />
      </div>

      {reason ? (
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("triage.reason")}
          </p>
          <p className="mt-1 text-sm leading-6">{reason}</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("triage.evidence")}
          </p>
          <div className="mt-2">
            {isSlackSource(source) ? (
              <SlackThreadPane query={slackQuery} t={t} />
            ) : (
              <StoredEvidencePane item={item} listItem={listItem} t={t} />
            )}
          </div>
        </section>

        <section className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("triage.actionsTaken")}
          </p>
          <div className="mt-2 space-y-3">
            <Button
              size="sm"
              onClick={() => {
                if (!latestDecision) return;
                approveMutation.mutate({
                  factoryId,
                  itemId: inboxItemId(item),
                  decisionId: latestDecision.decisionId,
                  confirm: true,
                });
              }}
              disabled={!latestDecision || approveMutation.isPending}
            >
              <IconPlayerPlay className="size-4" />
              {t("factoryRoute.approveAndStart")}
            </Button>
            {events.length > 0 ? (
              <div className="space-y-2">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-md bg-muted/20 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <TriageStatusPill status={event.status} />
                      <time className="text-xs text-muted-foreground">
                        {formatInboxAge(event.createdAt)}
                      </time>
                    </div>
                    <p className="mt-1 text-sm">{event.summary}</p>
                  </div>
                ))}
              </div>
            ) : runs.length > 0 ? (
              <div className="space-y-2">
                {runs.map((run, index) => (
                  <div
                    key={run.id ?? `${run.startedAt}-${index}`}
                    className="rounded-md bg-muted/20 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <TriageStatusPill status={run.status} />
                      <time className="text-xs text-muted-foreground">
                        {formatInboxAge(run.startedAt)}
                      </time>
                    </div>
                    <p className="mt-1 text-sm">
                      {run.error || run.provider || run.status}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("triage.noActions")}
              </p>
            )}
            {latestDecision ? (
              <div className="space-y-2 rounded-md bg-muted/20 p-3">
                <div className="flex flex-wrap gap-2">
                  {(["correct", "incorrect", "uncertain"] as Verdict[]).map(
                    (value) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={verdict === value ? "default" : "outline"}
                        onClick={() => setVerdict(value)}
                      >
                        {t(`triage.verdict.${value}`)}
                      </Button>
                    ),
                  )}
                </div>
                <Input
                  value={feedbackNote}
                  onChange={(event) => setFeedbackNote(event.target.value)}
                  placeholder={t("triage.notePlaceholder")}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (!verdict) return;
                    feedbackMutation.mutate({
                      factoryId,
                      decisionId: latestDecision.decisionId,
                      verdict,
                      ...(feedbackNote.trim()
                        ? { note: feedbackNote.trim() }
                        : {}),
                    });
                  }}
                  disabled={!verdict || feedbackMutation.isPending}
                >
                  {t("triage.submitFeedback")}
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

function SlackThreadPane({
  query,
  t,
}: {
  query: ReturnType<typeof useActionQuery<SlackThreadResponse>>;
  t: ReturnType<typeof useT>;
}) {
  if (query.isError) {
    return (
      <p className="text-sm text-destructive">
        {t("triage.threadUnavailable")}
      </p>
    );
  }
  if (query.isLoading) {
    return <InboxThreadSkeleton />;
  }
  const messages = query.data?.messages ?? [];
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("triage.noEvidence")}</p>
    );
  }
  return (
    <div className="space-y-2">
      {query.data?.coverage === "partial" ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t("triage.threadTruncated")}
        </p>
      ) : null}
      <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-md border border-border bg-background p-3">
        {messages.map((message, index) => (
          <article key={`${message.ts ?? index}`} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium">
                {message.username || message.user || message.botId || "Slack"}
              </span>
              {message.ts ? (
                <time className="shrink-0 text-[11px] text-muted-foreground">
                  {formatSlackTs(message.ts)}
                </time>
              ) : null}
            </div>
            <div className="mt-1">
              <SlackMrkdwn text={message.text ?? ""} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function StoredEvidencePane({
  item,
  listItem,
  t,
}: {
  item: InboxDetail;
  listItem: InboxListItem | null;
  t: ReturnType<typeof useT>;
}) {
  const text =
    item.summary || listItem?.summary || item.title || listItem?.title;
  if (!text) {
    return (
      <p className="text-sm text-muted-foreground">{t("triage.noEvidence")}</p>
    );
  }
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <EvidenceIcon source={item.source ?? listItem?.source} />
        {formatInboxSource(item.source ?? listItem?.source)}
      </div>
      <SlackMrkdwn text={text} />
    </div>
  );
}

function EvidenceIcon({ source }: { source?: string | null }) {
  const className = "size-3.5 shrink-0";
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("slack"))
    return <IconBrandSlack className={className} />;
  if (normalized.includes("github"))
    return <IconBrandGithub className={className} />;
  return <IconAlertCircle className={className} />;
}

function InboxListSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="space-y-2 rounded-lg bg-muted/20 p-3">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/3 rounded bg-muted/70" />
        </div>
      ))}
    </div>
  );
}

function InboxDetailSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      <div className="h-16 animate-pulse rounded bg-muted/70" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-40 animate-pulse rounded bg-muted/40" />
        <div className="h-40 animate-pulse rounded bg-muted/40" />
      </div>
    </div>
  );
}

function InboxThreadSkeleton() {
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/50" />
    </div>
  );
}

function inboxItemId(item: InboxListItem | InboxDetail | null): string {
  return item?.itemId || item?.id || "";
}

function inboxSnippet(item: InboxListItem | InboxDetail | null): string {
  const summary = item?.summary?.trim();
  if (summary) return summary;
  return item?.title?.trim() || "Untitled";
}

function isSlackSource(source?: string | null): boolean {
  return (source ?? "").toLowerCase().includes("slack");
}

function formatInboxSource(source: string | null | undefined) {
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("slack")) return "Slack";
  if (normalized.includes("github")) return "GitHub";
  if (normalized.includes("sentry")) return "Sentry";
  const trimmed = source?.trim();
  return trimmed ? trimmed : "Source";
}

function formatInboxAge(value: string | number | null | undefined) {
  if (!value) return null;
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

function formatSlackTs(ts: string) {
  const millis = Number(ts) * 1000;
  if (!Number.isFinite(millis)) return ts;
  return new Date(millis).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
