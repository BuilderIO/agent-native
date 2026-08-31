import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconBrandGithub,
  IconBrandSlack,
  IconBroadcast,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconLoader2,
  IconPlayerPlay,
  IconScale,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useSearchParams } from "react-router";

import {
  INBOX_RANGES,
  INBOX_RISKS,
  INBOX_SOURCES,
  INBOX_STATUSES,
  parseInboxRange,
  parseInboxRisk,
  parseInboxSource,
  parseInboxStatus,
  updatedAfterForRange,
  writeInboxFilterParam,
} from "@/components/factory/inbox-filters";
import { resolveInboxSourceUrl } from "@/components/factory/inbox-source-url";
import { BUILDER_SLACK_MENTION_LABEL } from "@/components/factory/slack-mrkdwn";
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

const inboxListColumns =
  "w-full gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(4.75rem,auto)_minmax(7.5rem,auto)_minmax(4.5rem,auto)] sm:items-start";

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
  author?: string | null;
  reason?: string | null;
  userLabels?: Record<string, string>;
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
  channelId?: string | null;
  threadTs?: string | null;
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
  channelId?: string | null;
  threadTs?: string | null;
  builderSlackUserId?: string | null;
  userLabels?: Record<string, string>;
  messages?: Array<{
    user?: string | null;
    username?: string | null;
    botId?: string | null;
    text?: string | null;
    ts?: string | null;
  }>;
};

type TriageConfigResponse = {
  builderSlackUserId?: string | null;
};

type InboxMetrics = {
  totalItems: number;
  decisions: number;
  runs: number;
};

export function FactoryInboxView({
  factoryId,
  metrics,
}: {
  factoryId: string;
  metrics?: InboxMetrics;
}) {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = parseInboxStatus(searchParams.get("status"));
  const risk = parseInboxRisk(searchParams.get("risk"));
  const range = parseInboxRange(searchParams.get("range"));
  const source = parseInboxSource(searchParams.get("source"));
  const updatedAfter = updatedAfterForRange(range);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("itemId"),
  );
  const [feedbackNote, setFeedbackNote] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [listReturnMotion, setListReturnMotion] = useState(false);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const listQuery = useActionQuery<InboxListResponse>("list-triage-items", {
    factoryId,
    limit: INBOX_PAGE_SIZE,
    ...(status ? { status } : {}),
    ...(risk ? { risk } : {}),
    ...(source ? { source } : {}),
    ...(updatedAfter ? { updatedAfter } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const configQuery = useActionQuery<TriageConfigResponse>(
    "get-triage-config",
    { factoryId },
  );
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
  const builderSlackUserId =
    slackQuery.data?.builderSlackUserId ??
    configQuery.data?.builderSlackUserId ??
    null;
  const mentionLabels = mergeUserLabels(
    selectedListItem?.userLabels,
    selectedItem?.userLabels,
    slackQuery.data?.userLabels,
  );

  useEffect(() => {
    setSelectedId(searchParams.get("itemId"));
  }, [searchParams]);

  useEffect(() => {
    setCursor(null);
    setCursorStack([]);
  }, [status, risk, range, source]);

  useEffect(() => {
    if (!selectedId) return;
    selectedRowRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedId, items.length]);

  function setInboxFilter(
    key: "status" | "risk" | "range" | "source",
    value: string,
  ) {
    setCursor(null);
    setCursorStack([]);
    setSearchParams((current) => writeInboxFilterParam(current, key, value), {
      replace: true,
    });
  }

  function selectItem(itemId: string) {
    setListReturnMotion(false);
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

  function clearSelection() {
    setListReturnMotion(true);
    setSelectedId(null);
    setVerdict(null);
    setFeedbackNote("");
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("itemId");
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
    <div className="p-4 lg:p-6">
      {!selectedId ? (
        <div
          className={
            listReturnMotion
              ? "flex flex-col gap-4 factory-inbox-pane-list-return"
              : "flex flex-col gap-4"
          }
        >
          <InboxMetricCards metrics={metrics} />
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 space-y-0">
              <div className="flex flex-wrap items-end gap-3">
                <InboxFilterSelect
                  id="factory-range-filter"
                  label={t("triage.rangeLabel")}
                  value={range}
                  placeholder={t("triage.rangeAll")}
                  options={INBOX_RANGES.map((value) => ({
                    value,
                    label:
                      value === "today"
                        ? t("triage.rangeToday")
                        : t("triage.range7d"),
                  }))}
                  onChange={(value) => setInboxFilter("range", value)}
                />
                <InboxFilterSelect
                  id="factory-status-filter"
                  label={t("triage.status")}
                  value={status}
                  placeholder={t("triage.statusPlaceholder")}
                  options={INBOX_STATUSES.map((value) => ({
                    value,
                    label: t(`triage.statusValues.${value}`),
                  }))}
                  onChange={(value) => setInboxFilter("status", value)}
                />
                <InboxFilterSelect
                  id="factory-risk-filter"
                  label={t("triage.risk")}
                  value={risk}
                  placeholder={t("triage.riskPlaceholder")}
                  options={INBOX_RISKS.map((value) => ({
                    value,
                    label: t(`triage.riskValues.${value}`),
                  }))}
                  onChange={(value) => setInboxFilter("risk", value)}
                />
                <InboxFilterSelect
                  id="factory-source-filter"
                  label={t("triage.source")}
                  value={source}
                  placeholder={t("triage.sourcePlaceholder")}
                  options={INBOX_SOURCES.map((value) => ({
                    value,
                    label: t(`triage.sourceValues.${value}`),
                  }))}
                  onChange={(value) => setInboxFilter("source", value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void listQuery.refetch()}
                disabled={listQuery.isFetching}
              >
                {listQuery.isFetching && (
                  <IconLoader2 className="animate-spin" />
                )}
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
                    const snippet = inboxSnippet(item, t("triage.untitled"));
                    const updatedAge = formatInboxAge(
                      item.updatedAt,
                      t("triage.relativeNow"),
                    );
                    return (
                      <button
                        key={id}
                        ref={selectedId === id ? selectedRowRef : undefined}
                        type="button"
                        className={`grid rounded-lg bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${inboxListColumns}`}
                        onClick={() => selectItem(id)}
                      >
                        <span className="min-w-0">
                          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                            {formatInboxSource(item.source ?? item.sourceName)}
                            {item.author?.trim()
                              ? ` · ${item.author.trim()}`
                              : ""}
                          </span>
                          <span className="mt-0.5 block truncate text-sm font-medium">
                            <SlackMrkdwn
                              text={snippet}
                              inline
                              mentionLabels={item.userLabels}
                              builderSlackUserId={builderSlackUserId}
                            />
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
                            <span className="text-sm text-muted-foreground">
                              -
                            </span>
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
                      disabled={
                        cursorStack.length === 0 || listQuery.isFetching
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
                        !listQuery.data?.hasMore || listQuery.isFetching
                      }
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
        </div>
      ) : (
        <div className="factory-inbox-pane-detail">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                className="gap-1 px-2"
                aria-label={t("factoryRoute.inboxBackToList")}
                onClick={clearSelection}
              >
                <IconChevronLeft className="size-4" />
                {t("factoryRoute.inboxTab")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              {detailQuery.isError ? (
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
                  mentionLabels={mentionLabels}
                  builderSlackUserId={builderSlackUserId}
                  t={t}
                  verdict={verdict}
                  setVerdict={setVerdict}
                  feedbackNote={feedbackNote}
                  setFeedbackNote={setFeedbackNote}
                  feedbackMutation={feedbackMutation}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function InboxDetailPane({
  factoryId,
  item,
  listItem,
  slackQuery,
  mentionLabels,
  builderSlackUserId,
  t,
  verdict,
  setVerdict,
  feedbackNote,
  setFeedbackNote,
  feedbackMutation,
}: {
  factoryId: string;
  item: InboxDetail;
  listItem: InboxListItem | null;
  slackQuery: ReturnType<typeof useActionQuery<SlackThreadResponse>>;
  mentionLabels: Record<string, string>;
  builderSlackUserId: string | null;
  t: ReturnType<typeof useT>;
  verdict: Verdict | null;
  setVerdict: (value: Verdict) => void;
  feedbackNote: string;
  setFeedbackNote: (value: string) => void;
  feedbackMutation: {
    mutate: (input: {
      factoryId: string;
      decisionId: string;
      verdict: Verdict;
      note?: string;
    }) => void;
    isPending: boolean;
    isError: boolean;
  };
}) {
  const source = item.source ?? listItem?.source ?? item.sourceName;
  const sourceUrl = resolveInboxSourceUrl({
    sourceUrl:
      item.sourceUrl ?? listItem?.sourceUrl ?? slackQuery.data?.sourceUrl,
    channelId: item.channelId ?? slackQuery.data?.channelId,
    threadTs: item.threadTs ?? slackQuery.data?.threadTs,
  });
  const reason =
    item.decisions?.[item.decisions.length - 1]?.reason ??
    item.decisions?.[item.decisions.length - 1]?.summary ??
    listItem?.reason ??
    null;
  const latestDecision = item.decisions?.[item.decisions.length - 1];
  const events = item.events ?? [];
  const runs = item.runs ?? [];
  const slack = isSlackSource(source);
  const author = (item.author ?? listItem?.author)?.trim() || null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <TriageStatusPill status={item.status ?? listItem?.status} />
        {author ? (
          <span className="text-xs text-muted-foreground">
            {t("triage.author")}: {author}
          </span>
        ) : null}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t("triage.openSource")}
            <IconExternalLink className="size-3" />
          </a>
        )}
      </div>

      {reason ? (
        <div className="rounded-md bg-muted/40 py-2">
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
          <p className="mt-1 text-sm text-muted-foreground">
            {t("triage.evidenceDescription")}
          </p>
          <div className="mt-2">
            {slack ? (
              <SlackThreadPane
                query={slackQuery}
                mentionLabels={mentionLabels}
                builderSlackUserId={builderSlackUserId}
                t={t}
              />
            ) : (
              <StoredEvidencePane
                item={item}
                listItem={listItem}
                mentionLabels={mentionLabels}
                builderSlackUserId={builderSlackUserId}
                t={t}
              />
            )}
          </div>
        </section>
        <section className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("triage.actionsTaken")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("triage.actionsTakenDescription")}
          </p>
          <div className="mt-2">
            <InboxActionList events={events} runs={runs} t={t} />
          </div>
        </section>
      </div>

      {latestDecision ? (
        <InboxFeedbackSection
          factoryId={factoryId}
          latestDecision={latestDecision}
          verdict={verdict}
          setVerdict={setVerdict}
          feedbackNote={feedbackNote}
          setFeedbackNote={setFeedbackNote}
          feedbackMutation={feedbackMutation}
          t={t}
        />
      ) : null}
    </>
  );
}

function SlackThreadPane({
  query,
  mentionLabels,
  builderSlackUserId,
  t,
}: {
  query: ReturnType<typeof useActionQuery<SlackThreadResponse>>;
  mentionLabels: Record<string, string>;
  builderSlackUserId: string | null;
  t: ReturnType<typeof useT>;
}) {
  const messages = query.data?.messages ?? [];
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
      {messages.map((message, index) => (
        <div
          key={message.ts ?? `message-${index}`}
          className={
            index === 0 ? undefined : "ms-6 border-s border-border ps-3"
          }
        >
          <SlackMessageCard
            message={message}
            mentionLabels={mentionLabels}
            builderSlackUserId={builderSlackUserId}
          />
        </div>
      ))}
    </div>
  );
}

function SlackMessageCard({
  message,
  mentionLabels,
  builderSlackUserId,
}: {
  message: NonNullable<SlackThreadResponse["messages"]>[number];
  mentionLabels: Record<string, string>;
  builderSlackUserId: string | null;
}) {
  return (
    <article className="rounded-md border border-border bg-background px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">
          {slackAuthorName(message, mentionLabels, builderSlackUserId)}
        </span>
        {message.ts ? (
          <time className="shrink-0 text-[11px] text-muted-foreground">
            {formatSlackTs(message.ts)}
          </time>
        ) : null}
      </div>
      <div className="mt-1">
        <SlackMrkdwn
          text={message.text ?? ""}
          mentionLabels={mentionLabels}
          builderSlackUserId={builderSlackUserId}
        />
      </div>
    </article>
  );
}

function InboxFeedbackSection({
  factoryId,
  latestDecision,
  verdict,
  setVerdict,
  feedbackNote,
  setFeedbackNote,
  feedbackMutation,
  t,
}: {
  factoryId: string;
  latestDecision: InboxDecision;
  verdict: Verdict | null;
  setVerdict: (value: Verdict) => void;
  feedbackNote: string;
  setFeedbackNote: (value: string) => void;
  feedbackMutation: {
    mutate: (input: {
      factoryId: string;
      decisionId: string;
      verdict: Verdict;
      note?: string;
    }) => void;
    isPending: boolean;
    isError: boolean;
  };
  t: ReturnType<typeof useT>;
}) {
  return (
    <section className="space-y-3 pt-10">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{t("triage.feedbackTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("triage.feedbackDescription")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["correct", "incorrect", "uncertain"] as Verdict[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={verdict === value ? "default" : "outline"}
            onClick={() => setVerdict(value)}
          >
            {t(`triage.verdict.${value}`)}
          </Button>
        ))}
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
            ...(feedbackNote.trim() ? { note: feedbackNote.trim() } : {}),
          });
        }}
        disabled={!verdict || feedbackMutation.isPending}
      >
        {t("triage.submitFeedback")}
      </Button>
      {feedbackMutation.isError ? (
        <p className="text-sm text-destructive">{t("triage.feedbackError")}</p>
      ) : null}
    </section>
  );
}

function InboxActionList({
  events,
  runs,
  t,
}: {
  events: InboxEvent[];
  runs: InboxRun[];
  t: ReturnType<typeof useT>;
}) {
  if (events.length > 0) {
    return (
      <div className="space-y-2">
        {events.map((event) => (
          <InboxEventCard key={event.id} event={event} />
        ))}
      </div>
    );
  }
  if (runs.length > 0) {
    return (
      <div className="space-y-2">
        {runs.map((run, index) => (
          <div
            key={run.id ?? `${run.startedAt}-${index}`}
            className="rounded-md bg-muted/20 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <TriageStatusPill status={run.status} />
              <time className="text-xs text-muted-foreground">
                {formatInboxAge(run.startedAt, t("triage.relativeNow"))}
              </time>
            </div>
            <p className="mt-1 text-sm">
              {run.error || run.provider || run.status}
            </p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">{t("triage.noActions")}</p>
  );
}

function InboxEventCard({ event }: { event: InboxEvent }) {
  const t = useT();
  return (
    <div className="rounded-md bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <TriageStatusPill status={event.status} />
        <time className="text-xs text-muted-foreground">
          {formatInboxAge(event.createdAt, t("triage.relativeNow"))}
        </time>
      </div>
      <p className="mt-1 text-sm">{event.summary}</p>
    </div>
  );
}

function StoredEvidencePane({
  item,
  listItem,
  mentionLabels,
  builderSlackUserId,
  t,
}: {
  item: InboxDetail;
  listItem: InboxListItem | null;
  mentionLabels: Record<string, string>;
  builderSlackUserId: string | null;
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
      <SlackMrkdwn
        text={text}
        mentionLabels={mentionLabels}
        builderSlackUserId={builderSlackUserId}
      />
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

function InboxFilterSelect({
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

function InboxMetricCards({ metrics }: { metrics?: InboxMetrics }) {
  const t = useT();
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <InboxMetricCard
        icon={IconBroadcast}
        title={t("factoryRoute.metricSignals")}
        hint={t("factoryRoute.metricSignalsHint")}
        value={metrics?.totalItems ?? 0}
      />
      <InboxMetricCard
        icon={IconScale}
        title={t("factoryRoute.metricRecommendations")}
        hint={t("factoryRoute.metricRecommendationsHint")}
        value={metrics?.decisions ?? 0}
      />
      <InboxMetricCard
        icon={IconPlayerPlay}
        title={t("factoryRoute.metricRuns")}
        hint={t("factoryRoute.metricRunsHint")}
        value={metrics?.runs ?? 0}
      />
    </div>
  );
}

function InboxMetricCard({
  icon: Icon,
  title,
  hint,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">{title}</p>
        </div>
        <p className="text-2xl font-semibold tracking-tight">
          {value.toLocaleString()}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
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

function mergeUserLabels(
  ...maps: Array<Record<string, string> | undefined>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [id, label] of Object.entries(map)) {
      if (label.trim()) merged[id] = label;
    }
  }
  return merged;
}

function slackAuthorName(
  message: {
    user?: string | null;
    username?: string | null;
    botId?: string | null;
  },
  mentionLabels: Record<string, string>,
  builderSlackUserId: string | null,
): string {
  const userId = message.user?.trim();
  if (
    userId &&
    builderSlackUserId &&
    userId.toUpperCase() === builderSlackUserId.toUpperCase()
  ) {
    return BUILDER_SLACK_MENTION_LABEL;
  }
  if (userId && mentionLabels[userId]) return mentionLabels[userId];
  if (message.username && !looksLikeSlackUserId(message.username)) {
    return message.username;
  }
  if (message.username) return message.username;
  return userId || message.botId || "Slack";
}

function looksLikeSlackUserId(value: string): boolean {
  return /^[UW][A-Z0-9]+$/i.test(value.trim());
}

function inboxSnippet(
  item: InboxListItem | InboxDetail | null,
  untitled: string,
): string {
  const summary = item?.summary?.trim();
  if (summary) return summary;
  return item?.title?.trim() || untitled;
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

function formatInboxAge(
  value: string | number | null | undefined,
  nowLabel: string,
) {
  if (!value) return null;
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
