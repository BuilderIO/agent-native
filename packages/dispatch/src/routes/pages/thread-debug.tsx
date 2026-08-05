import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconClock,
  IconDatabase,
  IconFileSearch,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { ActionQueryError } from "../../components/action-query-error";
import { DispatchShell } from "../../components/dispatch-shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import { cn } from "../../lib/utils";

export function meta() {
  return [{ title: "Thread Debug — Dispatch" }];
}

interface ThreadDebugSource {
  id: string;
  label: string;
  kind: "current" | "env" | "configured";
  current: boolean;
  connected: boolean;
  databaseUrlEnv: string | null;
  databaseAuthTokenEnv: string | null;
  canInspectAll: boolean;
}

interface ThreadSearchResult {
  id: string;
  ownerEmail: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  snippet: string;
}

interface ThreadMessage {
  index: number;
  id: string | null;
  role: string;
  createdAt: string | number | null;
  status: unknown;
  text: string;
  contentParts: any[];
  attachments: any[];
  metadata: unknown;
}

interface ThreadRun {
  id: string;
  status: string;
  turnId?: string | null;
  abortReason: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  terminalReason?: string | null;
  dispatchMode?: string | null;
  diagStage?: string | null;
  workerStage?: string | null;
  startedAt: number;
  completedAt: number | null;
  heartbeatAt: number | null;
  lastProgressAt?: number | null;
  durationMs?: number | null;
  peakRssMb?: number | null;
  events: Array<{ seq: number; event: any; rawEventData: string }>;
}

type ThreadDebugMode = "failures" | "threads";
type FailureStatus = "all" | "errored" | "aborted" | "truncated";
type FailureRange = "24h" | "7d" | "30d";

interface AgentRunFailure {
  id: string;
  threadId: string;
  sourceId?: string;
  sourceLabel?: string;
  source?: {
    id: string;
    label: string;
    kind?: string;
    databaseUrlEnv?: string | null;
  };
  ownerEmail: string;
  threadTitle: string;
  threadPreview: string;
  status: string;
  errorCode: string | null;
  errorDetail: string | null;
  terminalReason: string | null;
  abortReason: string | null;
  dispatchMode: string | null;
  diagStage: string | null;
  workerStage?: string | null;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
}

interface AgentRunFailuresResponse {
  failures: AgentRunFailure[];
  sources: Array<{
    source: {
      id: string;
      label: string;
      kind?: string;
      databaseUrlEnv?: string | null;
    };
    status: "ok" | "unsupported" | "unavailable" | "disconnected";
    failureCount: number;
    errorCode?: string | null;
  }>;
  partial: boolean;
  count?: number;
  access: { viewerEmail: string; scope: string; canInspectAll: boolean };
  filters?: {
    sourceId?: string;
    status?: FailureStatus;
    lookbackHours?: number;
    limit?: number;
  };
}

interface ThreadDebugResponse {
  source: {
    id: string;
    label: string;
    kind: string;
    databaseUrlEnv: string | null;
  };
  access: { viewerEmail: string; scope: string; canInspectAll: boolean };
  thread: ThreadSearchResult;
  lookup?: { requestedId: string; threadId: string; runId: string | null };
  messages: ThreadMessage[];
  debug: any;
  debugRuns: any[];
  queuedMessages: any[];
  threadData: any;
  rawThreadData: string;
  runs: ThreadRun[];
  traces: { summaries: any[]; spans: any[] };
  feedback: any[];
  satisfaction: any[];
  evals: any[];
  checkpoints: any[];
}

const FAILURE_RANGE_HOURS: Record<FailureRange, number> = {
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
};

function parseMode(value: string | null): ThreadDebugMode {
  return value === "threads" ? "threads" : "failures";
}

function parseFailureStatus(value: string | null): FailureStatus {
  return value === "errored" || value === "aborted" || value === "truncated"
    ? value
    : "all";
}

function parseFailureRange(value: string | null): FailureRange {
  return value === "7d" || value === "30d" ? value : "24h";
}

function failureSourceId(failure: AgentRunFailure): string {
  return failure.sourceId || failure.source?.id || "current";
}

function failureSourceLabel(failure: AgentRunFailure): string {
  return (
    failure.sourceLabel || failure.source?.label || failureSourceId(failure)
  );
}

function formatDate(value: number | string | null | undefined): string {
  if (value == null || value === "") return "n/a";
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function formatDuration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function eventLabel(event: any): string {
  if (!event || typeof event !== "object") return "event";
  if (event.type === "tool_start") return `tool_start · ${event.tool}`;
  if (event.type === "tool_done") return `tool_done · ${event.tool}`;
  if (event.type === "text") return "text";
  if (event.type === "error") return `error · ${event.errorCode ?? "agent"}`;
  return String(event.type ?? "event");
}

function messageTitle(message: ThreadMessage): string {
  const role = message.role || "unknown";
  return `${role.charAt(0).toUpperCase()}${role.slice(1)} ${message.index + 1}`;
}

function toolParts(message: ThreadMessage): any[] {
  return message.contentParts.filter((part) => part?.type === "tool-call");
}

function diagnosticStage(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { stage?: unknown; detail?: unknown };
    const stage =
      typeof parsed.stage === "string" && parsed.stage.trim()
        ? parsed.stage.trim()
        : value;
    const detail =
      typeof parsed.detail === "string" && parsed.detail.trim()
        ? parsed.detail.trim()
        : "";
    return detail ? `${stage}: ${detail}` : stage;
  } catch {
    return value;
  }
}

function RawBlock({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "max-h-[520px] overflow-auto rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-foreground",
        "whitespace-pre-wrap break-words",
        className,
      )}
    >
      {typeof value === "string" ? value : json(value)}
    </pre>
  );
}

function SourceBadge({ source }: { source: ThreadDebugSource }) {
  return (
    <Badge variant={source.current ? "default" : "secondary"}>
      {source.current ? "current" : source.kind}
    </Badge>
  );
}

function ResultCard({
  result,
  selected,
  onSelect,
}: {
  result: ThreadSearchResult;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border px-3 py-3 text-left transition-colors",
        selected
          ? "border-foreground bg-muted"
          : "bg-card hover:border-foreground/30 hover:bg-muted/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {result.title || result.preview || result.id}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {result.id}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {result.messageCount}
        </Badge>
      </div>
      <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {result.snippet || result.preview || "No preview"}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="truncate">{result.ownerEmail}</span>
        <span className="shrink-0">{formatDate(result.updatedAt)}</span>
      </div>
    </button>
  );
}

function FailureCard({
  failure,
  selected,
  onSelect,
}: {
  failure: AgentRunFailure;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const summary =
    failure.errorCode ||
    failure.terminalReason ||
    failure.abortReason ||
    failure.status;
  const statusLabel =
    failure.status === "errored"
      ? t("dispatch.pages.threadDebugErrored", {
          defaultValue: "Errored",
        })
      : failure.status === "aborted"
        ? t("dispatch.pages.threadDebugAborted", {
            defaultValue: "Aborted",
          })
        : failure.status === "truncated"
          ? t("dispatch.pages.threadDebugTruncated", {
              defaultValue: "Truncated",
            })
          : failure.status;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border px-3 py-3 text-left transition-colors",
        selected
          ? "border-foreground bg-muted"
          : "bg-card hover:border-foreground/30 hover:bg-muted/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {failure.threadTitle || failure.threadPreview || failure.threadId}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {failure.id}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {statusLabel}
        </Badge>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-foreground">
        <IconAlertTriangle className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{summary}</span>
      </div>
      {failure.errorDetail ? (
        <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {failure.errorDetail}
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="truncate">
          {failureSourceLabel(failure)} · {failure.ownerEmail}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <IconClock className="size-3" />
          {formatDate(failure.completedAt ?? failure.startedAt)}
          {failure.durationMs == null
            ? null
            : ` · ${formatDuration(failure.durationMs)}`}
        </span>
      </div>
      <span className="sr-only">
        {t("dispatch.pages.threadDebugInspectFailure", {
          defaultValue: "Inspect failed run",
        })}
      </span>
    </button>
  );
}

function MessageBlock({ message }: { message: ThreadMessage }) {
  const tools = toolParts(message);
  return (
    <div className="rounded-lg bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant={message.role === "assistant" ? "default" : "secondary"}
          >
            {message.role}
          </Badge>
          <span className="truncate text-sm font-medium text-foreground">
            {messageTitle(message)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {message.attachments.length > 0 ? (
            <Badge variant="outline">{message.attachments.length} files</Badge>
          ) : null}
          <span>{formatDate(message.createdAt)}</span>
        </div>
      </div>
      <div className="space-y-3 px-3 py-3">
        {message.text ? (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {message.text}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No text content</div>
        )}
        {tools.length > 0 ? (
          <div className="space-y-2">
            {tools.map((tool, index) => (
              <details
                key={`${message.id ?? message.index}-tool-${index}`}
                className="rounded-md border bg-muted/30 px-3 py-2"
              >
                <summary className="cursor-pointer text-xs font-medium text-foreground">
                  {tool.toolName ?? tool.name ?? "tool-call"}
                </summary>
                <RawBlock value={tool} className="mt-2 max-h-72" />
              </details>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ThreadDetail({ detail }: { detail: ThreadDebugResponse }) {
  const t = useT();
  const rawBundle = useMemo(
    () => ({
      thread: detail.thread,
      debug: detail.debug,
      debugRuns: detail.debugRuns,
      queuedMessages: detail.queuedMessages,
      threadData: detail.threadData,
      runs: detail.runs,
      traces: detail.traces,
      feedback: detail.feedback,
      satisfaction: detail.satisfaction,
      evals: detail.evals,
      checkpoints: detail.checkpoints,
    }),
    [detail],
  );

  return (
    <div className="rounded-lg bg-card">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-foreground">
              {detail.thread.title || detail.thread.preview || detail.thread.id}
            </div>
            <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {detail.thread.id}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{detail.messages.length} messages</Badge>
            <Badge variant="secondary">{detail.runs.length} runs</Badge>
            <Badge variant="outline">{detail.source.label}</Badge>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <div className="truncate">Owner: {detail.thread.ownerEmail}</div>
          <div>Created: {formatDate(detail.thread.createdAt)}</div>
          <div>Updated: {formatDate(detail.thread.updatedAt)}</div>
        </div>
      </div>

      <Tabs defaultValue="transcript" className="p-4">
        <TabsList>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="internals">Internals</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="mt-4 space-y-3">
          {detail.messages.length > 0 ? (
            detail.messages.map((message) => (
              <MessageBlock
                key={message.id ?? `message-${message.index}`}
                message={message}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No persisted messages.
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-4 space-y-3">
          {detail.runs.length > 0 ? (
            detail.runs.map((run) => (
              <details key={run.id} className="rounded-lg bg-card">
                <summary className="cursor-pointer px-4 py-3">
                  <div className="inline-flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{run.status}</Badge>
                    <span className="font-mono text-xs text-foreground">
                      {run.id}
                    </span>
                    {run.errorCode ? (
                      <span className="font-mono text-xs text-destructive">
                        {run.errorCode}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {formatDate(run.startedAt)}
                    </span>
                  </div>
                </summary>
                <div className="space-y-3 border-t px-4 py-3">
                  <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <div className="text-muted-foreground">
                        {t("dispatch.pages.threadDebugFailureCode", {
                          defaultValue: "Failure code",
                        })}
                      </div>
                      <div className="mt-0.5 break-words font-mono text-foreground">
                        {run.errorCode || "n/a"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">
                        {t("dispatch.pages.threadDebugTerminalReason", {
                          defaultValue: "Terminal reason",
                        })}
                      </div>
                      <div className="mt-0.5 break-words font-mono text-foreground">
                        {run.terminalReason || run.abortReason || "n/a"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">
                        {t("dispatch.pages.threadDebugDispatchMode", {
                          defaultValue: "Dispatch mode",
                        })}
                      </div>
                      <div className="mt-0.5 break-words font-mono text-foreground">
                        {run.dispatchMode || "foreground"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">
                        {t("dispatch.pages.threadDebugLastStage", {
                          defaultValue: "Last stage",
                        })}
                      </div>
                      <div className="mt-0.5 break-words font-mono text-foreground">
                        {diagnosticStage(run.workerStage) ||
                          diagnosticStage(run.diagStage) ||
                          "n/a"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">
                        {t("dispatch.pages.threadDebugDuration", {
                          defaultValue: "Duration",
                        })}
                      </div>
                      <div className="mt-0.5 text-foreground">
                        {formatDuration(
                          run.durationMs ??
                            (run.completedAt == null
                              ? null
                              : run.completedAt - run.startedAt),
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">
                        {t("dispatch.pages.threadDebugLastProgress", {
                          defaultValue: "Last progress",
                        })}
                      </div>
                      <div className="mt-0.5 text-foreground">
                        {formatDate(run.lastProgressAt ?? run.heartbeatAt)}
                      </div>
                    </div>
                  </div>
                  {run.errorDetail ? (
                    <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                      {run.errorDetail}
                    </div>
                  ) : null}
                  {run.events.map((event) => (
                    <details
                      key={`${run.id}-${event.seq}`}
                      className="rounded-md border bg-muted/30 px-3 py-2"
                    >
                      <summary className="cursor-pointer text-xs font-medium text-foreground">
                        #{event.seq} {eventLabel(event.event)}
                      </summary>
                      <RawBlock value={event.event} className="mt-2 max-h-72" />
                    </details>
                  ))}
                  {run.events.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No retained run events.
                    </div>
                  ) : null}
                </div>
              </details>
            ))
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No retained runs.
            </div>
          )}
        </TabsContent>

        <TabsContent value="internals" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium text-foreground">
                Debug Runs
              </div>
              <RawBlock
                value={
                  detail.debugRuns.length > 0
                    ? detail.debugRuns
                    : (detail.debug ?? {})
                }
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-foreground">
                Trace Summaries
              </div>
              <RawBlock value={detail.traces.summaries} />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-foreground">
                Trace Spans
              </div>
              <RawBlock value={detail.traces.spans} />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-foreground">
                Feedback And Evals
              </div>
              <RawBlock
                value={{
                  feedback: detail.feedback,
                  satisfaction: detail.satisfaction,
                  evals: detail.evals,
                  checkpoints: detail.checkpoints,
                }}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="raw" className="mt-4 space-y-4">
          <RawBlock value={rawBundle} />
          <RawBlock value={detail.rawThreadData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ThreadDebugRoute() {
  const t = useT();
  const [routeSearchParams, setRouteSearchParams] = useSearchParams();
  const mode = parseMode(routeSearchParams.get("mode"));
  const sourceId =
    routeSearchParams.get("source") ||
    (mode === "failures" ? "all" : "current");
  const ownerEmail = routeSearchParams.get("owner") || "";
  const query = routeSearchParams.get("query") || "";
  const status = parseFailureStatus(routeSearchParams.get("status"));
  const range = parseFailureRange(routeSearchParams.get("range"));
  const runId = routeSearchParams.get("runId") || "";
  const threadId = routeSearchParams.get("threadId") || "";
  const inspectSourceId = routeSearchParams.get("inspectSource") || "";
  const [lookupId, setLookupId] = useState("");

  function updateRouteState(
    updates: Record<string, string | null | undefined>,
  ) {
    const next = new URLSearchParams(routeSearchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setRouteSearchParams(next, { replace: true });
  }

  const sourcesQuery = useActionQuery<{
    access: {
      viewerEmail: string;
      orgId: string | null;
      role: string | null;
      envAdmin: boolean;
      canInspectAll: boolean;
      memberCount: number;
    };
    sources: ThreadDebugSource[];
  }>("list-agent-thread-sources", {});
  const { data: sourcesData, isLoading: sourcesLoading } = sourcesQuery;

  const sources: ThreadDebugSource[] = sourcesData?.sources ?? [];
  const failureParams = useMemo(
    () => ({
      sourceId,
      ownerEmail: ownerEmail.trim() || undefined,
      status,
      lookbackHours: FAILURE_RANGE_HOURS[range],
      limit: 25,
    }),
    [ownerEmail, range, sourceId, status],
  );
  const {
    data: failuresData,
    isLoading: failuresLoading,
    error: failuresError,
    refetch: refetchFailures,
  } = useActionQuery<AgentRunFailuresResponse>(
    "list-agent-run-failures",
    failureParams,
    { enabled: mode === "failures" },
  );
  const failures = failuresData?.failures ?? [];
  const unavailableFailureSources = (failuresData?.sources ?? []).filter(
    (source) => source.status !== "ok",
  );
  const failureSourceStatusLabels = {
    ok: "ok",
    disconnected: t("dispatch.pages.threadDebugDisconnected", {
      defaultValue: "disconnected",
    }),
    unsupported: t("dispatch.pages.threadDebugUnsupported", {
      defaultValue: "unsupported",
    }),
    unavailable: t("dispatch.pages.threadDebugUnavailable", {
      defaultValue: "unavailable",
    }),
  };

  const threadSourceId = sourceId === "all" ? "current" : sourceId;
  const detailSourceId =
    runId && inspectSourceId ? inspectSourceId : threadSourceId;
  const searchParams = useMemo(
    () => ({
      sourceId: threadSourceId,
      query: query.trim() || undefined,
      ownerEmail: ownerEmail.trim() || undefined,
      limit: 25,
    }),
    [ownerEmail, query, threadSourceId],
  );
  const {
    data: searchData,
    isLoading: searchLoading,
    error: searchError,
    refetch: refetchSearch,
  } = useActionQuery<{
    count: number;
    threads: ThreadSearchResult[];
    access: { scope: string; canInspectAll: boolean };
    source: { id: string; label: string };
  }>("search-agent-threads", searchParams, { enabled: mode === "threads" });
  const searchThreads: ThreadSearchResult[] = searchData?.threads ?? [];

  const detailParams = useMemo(
    () => ({
      sourceId: detailSourceId,
      ...(runId ? { runId } : { threadId }),
      ownerEmail: ownerEmail.trim() || undefined,
      maxRuns: 20,
      maxEvents: 800,
      maxTraceSpans: 600,
    }),
    [detailSourceId, ownerEmail, runId, threadId],
  );
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useActionQuery<ThreadDebugResponse>(
    "get-agent-thread-debug",
    detailParams,
    {
      enabled: Boolean(runId || threadId),
    },
  );

  const selectedSource = sources.find((source) => source.id === threadSourceId);
  const detailPane = (
    <section className="min-w-0">
      {detailError ? (
        <ActionQueryError
          error={detailError}
          onRetry={() => void refetchDetail()}
        />
      ) : null}
      {detailLoading ? (
        <div className="rounded-lg bg-card p-4">
          <Skeleton className="h-6 w-72" />
          <Skeleton className="mt-3 h-4 w-96" />
          <Skeleton className="mt-6 h-[520px] w-full" />
        </div>
      ) : detail ? (
        <ThreadDetail detail={detail} />
      ) : (
        <div className="flex min-h-[520px] flex-col items-center justify-center rounded-lg border border-dashed bg-card px-4 text-center text-sm text-muted-foreground">
          <IconFileSearch className="mb-2 size-5" />
          {t("dispatch.pages.threadDebugSelectPrompt", {
            defaultValue: "Select a failed run or thread to inspect.",
          })}
        </div>
      )}
    </section>
  );

  return (
    <DispatchShell
      title={t("dispatch.pages.threadDebugTitle", {
        defaultValue: "Thread Debug",
      })}
      description={t("dispatch.pages.threadDebugDescription", {
        defaultValue:
          "Inspect failed agent runs, persisted threads, run events, and AI internals.",
      })}
    >
      <div className="space-y-4">
        {sourcesQuery.isError ? (
          <ActionQueryError
            error={sourcesQuery.error}
            onRetry={() => void sourcesQuery.refetch()}
          />
        ) : null}
        <Tabs
          value={mode}
          onValueChange={(value) => {
            const nextMode = parseMode(value);
            updateRouteState({
              mode: nextMode,
              source:
                nextMode === "threads" && sourceId === "all"
                  ? "current"
                  : sourceId,
              runId: null,
              threadId: null,
              inspectSource: null,
            });
          }}
        >
          <TabsList>
            <TabsTrigger value="failures">
              {t("dispatch.pages.threadDebugFailedRuns", {
                defaultValue: "Failed runs",
              })}
            </TabsTrigger>
            <TabsTrigger value="threads">
              {t("dispatch.pages.threadDebugThreads", {
                defaultValue: "Threads",
              })}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="failures" className="mt-4 space-y-4">
            <section className="rounded-lg bg-card p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[220px_1fr_180px_150px]">
                <Select
                  value={sourceId}
                  onValueChange={(value) =>
                    updateRouteState({
                      source: value,
                      runId: null,
                      threadId: null,
                      inspectSource: null,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("dispatch.pages.threadDebugSource", {
                        defaultValue: "Source",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("dispatch.pages.threadDebugAllSources", {
                        defaultValue: "All sources",
                      })}
                    </SelectItem>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={ownerEmail}
                  onChange={(event) =>
                    updateRouteState({ owner: event.target.value })
                  }
                  placeholder={t("dispatch.pages.threadDebugOwner", {
                    defaultValue: "Owner email",
                  })}
                />
                <Select
                  value={status}
                  onValueChange={(value) =>
                    updateRouteState({
                      status: parseFailureStatus(value),
                      runId: null,
                      inspectSource: null,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("dispatch.pages.threadDebugStatus", {
                        defaultValue: "Status",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("dispatch.pages.threadDebugAllStatuses", {
                        defaultValue: "All statuses",
                      })}
                    </SelectItem>
                    <SelectItem value="errored">
                      {t("dispatch.pages.threadDebugErrored", {
                        defaultValue: "Errored",
                      })}
                    </SelectItem>
                    <SelectItem value="aborted">
                      {t("dispatch.pages.threadDebugAborted", {
                        defaultValue: "Aborted",
                      })}
                    </SelectItem>
                    <SelectItem value="truncated">
                      {t("dispatch.pages.threadDebugTruncated", {
                        defaultValue: "Truncated",
                      })}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={range}
                  onValueChange={(value) =>
                    updateRouteState({
                      range: parseFailureRange(value),
                      runId: null,
                      inspectSource: null,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("dispatch.pages.threadDebugRange", {
                        defaultValue: "Time range",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">
                      {t("dispatch.pages.threadDebugRange24h", {
                        defaultValue: "Last 24 hours",
                      })}
                    </SelectItem>
                    <SelectItem value="7d">
                      {t("dispatch.pages.threadDebugRange7d", {
                        defaultValue: "Last 7 days",
                      })}
                    </SelectItem>
                    <SelectItem value="30d">
                      {t("dispatch.pages.threadDebugRange30d", {
                        defaultValue: "Last 30 days",
                      })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {failuresData?.count ?? failures.length}{" "}
                  {t("dispatch.pages.threadDebugFailureResults", {
                    defaultValue: "failed runs",
                  })}
                </span>
                <span>·</span>
                <span>
                  {failuresData?.access?.scope ??
                    t("dispatch.pages.threadDebugCurrentScope", {
                      defaultValue: "current scope",
                    })}
                </span>
                {failuresData?.partial ? (
                  <Badge variant="outline">
                    {t("dispatch.pages.threadDebugPartialResults", {
                      defaultValue: "Partial results",
                    })}
                  </Badge>
                ) : null}
              </div>
              {unavailableFailureSources.length > 0 ? (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {t("dispatch.pages.threadDebugUnavailableSources", {
                      defaultValue: "Unavailable sources:",
                    })}{" "}
                    {unavailableFailureSources
                      .map(
                        ({ source, status: sourceStatus }) =>
                          `${source.label} (${failureSourceStatusLabels[sourceStatus]})`,
                      )
                      .join(", ")}
                  </span>
                </div>
              ) : null}
            </section>

            {failuresError ? (
              <ActionQueryError
                error={failuresError}
                onRetry={() => void refetchFailures()}
              />
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
              <section className="min-h-[520px] rounded-lg bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="text-sm font-semibold text-foreground">
                    {t("dispatch.pages.threadDebugFailedRuns", {
                      defaultValue: "Failed runs",
                    })}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void refetchFailures()}
                    aria-label={t("dispatch.pages.threadDebugRefreshFailures", {
                      defaultValue: "Refresh failed runs",
                    })}
                  >
                    <IconRefresh className="size-4" />
                  </Button>
                </div>
                <div className="max-h-[760px] space-y-2 overflow-auto p-3">
                  {failuresLoading ? (
                    <>
                      <Skeleton className="h-32 w-full rounded-lg" />
                      <Skeleton className="h-32 w-full rounded-lg" />
                      <Skeleton className="h-32 w-full rounded-lg" />
                    </>
                  ) : null}
                  {!failuresLoading && failures.length === 0 ? (
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
                      <IconDatabase className="mb-2 size-5" />
                      {t("dispatch.pages.threadDebugNoFailures", {
                        defaultValue: "No failed runs found.",
                      })}
                    </div>
                  ) : null}
                  {failures.map((failure) => (
                    <FailureCard
                      key={`${failureSourceId(failure)}:${failure.id}`}
                      failure={failure}
                      selected={
                        runId === failure.id &&
                        detailSourceId === failureSourceId(failure)
                      }
                      onSelect={() =>
                        updateRouteState({
                          inspectSource: failureSourceId(failure),
                          runId: failure.id,
                          threadId: null,
                        })
                      }
                    />
                  ))}
                </div>
              </section>
              {detailPane}
            </div>
          </TabsContent>

          <TabsContent value="threads" className="mt-4 space-y-4">
            <section className="rounded-lg bg-card p-4">
              <div className="grid gap-3 lg:grid-cols-[220px_1fr_260px_auto]">
                <Select
                  value={threadSourceId}
                  onValueChange={(value) =>
                    updateRouteState({
                      source: value,
                      runId: null,
                      threadId: null,
                      inspectSource: null,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("dispatch.pages.threadDebugSource", {
                        defaultValue: "Source",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.label}
                      </SelectItem>
                    ))}
                    {sources.length === 0 ? (
                      <SelectItem value="current">
                        {t("dispatch.pages.threadDebugCurrentDatabase", {
                          defaultValue: "Current Dispatch DB",
                        })}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
                <Input
                  value={query}
                  onChange={(event) =>
                    updateRouteState({ query: event.target.value })
                  }
                  placeholder={t(
                    "dispatch.pages.threadDebugSearchPlaceholder",
                    {
                      defaultValue: "Search title, preview, messages, tools",
                    },
                  )}
                />
                <Input
                  value={ownerEmail}
                  onChange={(event) =>
                    updateRouteState({ owner: event.target.value })
                  }
                  placeholder={t("dispatch.pages.threadDebugOwner", {
                    defaultValue: "Owner email",
                  })}
                />
                <Button type="button" onClick={() => void refetchSearch()}>
                  <IconSearch className="size-4" />
                  {t("dispatch.pages.threadDebugSearch", {
                    defaultValue: "Search",
                  })}
                </Button>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                <Input
                  value={lookupId}
                  onChange={(event) => setLookupId(event.target.value)}
                  placeholder={t(
                    "dispatch.pages.threadDebugLookupPlaceholder",
                    {
                      defaultValue: "Paste thread or request/run ID",
                    },
                  )}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const trimmed = lookupId.trim();
                    if (!trimmed) return;
                    updateRouteState(
                      trimmed.startsWith("run-")
                        ? {
                            runId: trimmed,
                            threadId: null,
                            inspectSource: null,
                          }
                        : {
                            threadId: trimmed,
                            runId: null,
                            inspectSource: null,
                          },
                    );
                  }}
                >
                  <IconFileSearch className="size-4" />
                  {t("dispatch.pages.threadDebugInspect", {
                    defaultValue: "Inspect",
                  })}
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {sourcesLoading ? <Skeleton className="h-5 w-32" /> : null}
                {selectedSource ? (
                  <SourceBadge source={selectedSource} />
                ) : null}
                {selectedSource?.databaseUrlEnv ? (
                  <Badge variant="outline" className="font-mono">
                    {selectedSource.databaseUrlEnv}
                  </Badge>
                ) : null}
                {sourcesData?.access ? (
                  <span>
                    {sourcesData.access.viewerEmail} ·{" "}
                    {sourcesData.access.canInspectAll
                      ? t("dispatch.pages.threadDebugAdminScope", {
                          defaultValue: "admin scope",
                        })
                      : t("dispatch.pages.threadDebugOwnScope", {
                          defaultValue: "own scope",
                        })}
                  </span>
                ) : null}
              </div>
            </section>

            {searchError ? (
              <ActionQueryError
                error={searchError}
                onRetry={() => void refetchSearch()}
              />
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
              <section className="min-h-[520px] rounded-lg bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {t("dispatch.pages.threadDebugThreads", {
                        defaultValue: "Threads",
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {searchData?.count ?? 0}{" "}
                      {t("dispatch.pages.threadDebugResults", {
                        defaultValue: "results",
                      })}{" "}
                      ·{" "}
                      {searchData?.access?.scope ??
                        t("dispatch.pages.threadDebugCurrentScope", {
                          defaultValue: "current scope",
                        })}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void refetchSearch()}
                    aria-label={t("dispatch.pages.threadDebugRefreshThreads", {
                      defaultValue: "Refresh threads",
                    })}
                  >
                    <IconRefresh className="size-4" />
                  </Button>
                </div>
                <div className="max-h-[760px] space-y-2 overflow-auto p-3">
                  {searchLoading ? (
                    <>
                      <Skeleton className="h-28 w-full rounded-lg" />
                      <Skeleton className="h-28 w-full rounded-lg" />
                      <Skeleton className="h-28 w-full rounded-lg" />
                    </>
                  ) : null}
                  {!searchLoading && searchThreads.length === 0 ? (
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
                      <IconDatabase className="mb-2 size-5" />
                      {t("dispatch.pages.threadDebugNoThreads", {
                        defaultValue: "No threads found.",
                      })}
                    </div>
                  ) : null}
                  {searchThreads.map((result) => (
                    <ResultCard
                      key={result.id}
                      result={result}
                      selected={threadId === result.id}
                      onSelect={() =>
                        updateRouteState({
                          threadId: result.id,
                          runId: null,
                          inspectSource: null,
                        })
                      }
                    />
                  ))}
                </div>
              </section>
              {detailPane}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DispatchShell>
  );
}
