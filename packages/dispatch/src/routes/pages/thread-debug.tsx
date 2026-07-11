import { agentNativePath, useActionQuery } from "@agent-native/core/client";
import {
  IconDatabase,
  IconFileSearch,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

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
  abortReason: string | null;
  startedAt: number;
  completedAt: number | null;
  heartbeatAt: number | null;
  events: Array<{ seq: number; event: any; rawEventData: string }>;
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

function formatDate(value: number | string | null | undefined): string {
  if (value == null || value === "") return "n/a";
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
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

function MessageBlock({ message }: { message: ThreadMessage }) {
  const tools = toolParts(message);
  return (
    <div className="rounded-lg border bg-card">
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
    <div className="rounded-lg border bg-card">
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
              <details key={run.id} className="rounded-lg border bg-card">
                <summary className="cursor-pointer px-4 py-3">
                  <div className="inline-flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{run.status}</Badge>
                    <span className="font-mono text-xs text-foreground">
                      {run.id}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(run.startedAt)}
                    </span>
                  </div>
                </summary>
                <div className="space-y-2 border-t px-4 py-3">
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
  const [sourceId, setSourceId] = useState("current");
  const [query, setQuery] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [threadId, setThreadId] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState({
    sourceId: "current",
    query: "",
    ownerEmail: "",
  });
  const [selected, setSelected] = useState<{
    sourceId: string;
    threadId: string;
    ownerEmail?: string;
  } | null>(null);

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
  const searchParams = useMemo(
    () => ({
      sourceId: submittedSearch.sourceId,
      query: submittedSearch.query || undefined,
      ownerEmail: submittedSearch.ownerEmail || undefined,
      limit: 25,
    }),
    [submittedSearch],
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
  }>("search-agent-threads", searchParams);
  const searchThreads: ThreadSearchResult[] = searchData?.threads ?? [];

  const detailParams = useMemo(
    () => ({
      sourceId: selected?.sourceId ?? "current",
      threadId: selected?.threadId ?? "",
      ownerEmail: selected?.ownerEmail,
      maxRuns: 20,
      maxEvents: 800,
      maxTraceSpans: 600,
    }),
    [selected],
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
      enabled: Boolean(selected?.threadId),
    },
  );

  const selectedSource = sources.find((source) => source.id === sourceId);

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: "thread-debug",
        path:
          typeof window === "undefined"
            ? "/thread-debug"
            : window.location.pathname,
        sourceId,
        query,
        ownerEmail: ownerEmail.trim() || undefined,
        threadId: selected?.threadId ?? (threadId.trim() || undefined),
      }),
    }).catch(() => {});
  }, [ownerEmail, query, selected?.threadId, sourceId, threadId]);

  return (
    <DispatchShell
      title="Thread Debug"
      description="Inspect persisted agent chat threads, run events, and AI internals."
    >
      <div className="space-y-4">
        {sourcesQuery.isError ? (
          <ActionQueryError
            error={sourcesQuery.error}
            onRetry={() => void sourcesQuery.refetch()}
          />
        ) : null}
        <section className="rounded-lg border bg-card p-4">
          <div className="grid gap-3 lg:grid-cols-[220px_1fr_260px_auto]">
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger>
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.label}
                  </SelectItem>
                ))}
                {sources.length === 0 ? (
                  <SelectItem value="current">Current Dispatch DB</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, preview, messages, tools"
            />
            <Input
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              placeholder="Owner email"
            />
            <Button
              type="button"
              onClick={() =>
                setSubmittedSearch({
                  sourceId,
                  query: query.trim(),
                  ownerEmail: ownerEmail.trim(),
                })
              }
            >
              <IconSearch size={16} />
              Search
            </Button>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
            <Input
              value={threadId}
              onChange={(event) => setThreadId(event.target.value)}
              placeholder="Paste thread ID"
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const trimmed = threadId.trim();
                if (!trimmed) return;
                setSelected({
                  sourceId,
                  threadId: trimmed,
                  ownerEmail: ownerEmail.trim() || undefined,
                });
              }}
            >
              <IconFileSearch size={16} />
              Inspect
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {sourcesLoading ? <Skeleton className="h-5 w-32" /> : null}
            {selectedSource ? <SourceBadge source={selectedSource} /> : null}
            {selectedSource?.databaseUrlEnv ? (
              <Badge variant="outline" className="font-mono">
                {selectedSource.databaseUrlEnv}
              </Badge>
            ) : null}
            {sourcesData?.access ? (
              <span>
                {sourcesData.access.viewerEmail} ·{" "}
                {sourcesData.access.canInspectAll ? "admin scope" : "own scope"}
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
          <section className="min-h-[520px] rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Threads
                </div>
                <div className="text-xs text-muted-foreground">
                  {searchData?.count ?? 0} results ·{" "}
                  {searchData?.access?.scope ?? "current scope"}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => refetchSearch()}
                aria-label="Refresh threads"
              >
                <IconRefresh size={16} />
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
                  <IconDatabase className="mb-2 h-5 w-5" />
                  No threads found.
                </div>
              ) : null}
              {searchThreads.map((result) => (
                <ResultCard
                  key={result.id}
                  result={result}
                  selected={selected?.threadId === result.id}
                  onSelect={() =>
                    setSelected({
                      sourceId: submittedSearch.sourceId,
                      threadId: result.id,
                      ownerEmail: submittedSearch.ownerEmail || undefined,
                    })
                  }
                />
              ))}
            </div>
          </section>

          <section className="min-w-0">
            {detailError ? (
              <ActionQueryError
                error={detailError}
                onRetry={() => void refetchDetail()}
              />
            ) : null}
            {detailLoading ? (
              <div className="rounded-lg border bg-card p-4">
                <Skeleton className="h-6 w-72" />
                <Skeleton className="mt-3 h-4 w-96" />
                <Skeleton className="mt-6 h-[520px] w-full" />
              </div>
            ) : detail ? (
              <ThreadDetail detail={detail} />
            ) : (
              <div className="flex min-h-[520px] flex-col items-center justify-center rounded-lg border border-dashed bg-card px-4 text-center text-sm text-muted-foreground">
                <IconFileSearch className="mb-2 h-5 w-5" />
                Select or inspect a thread.
              </div>
            )}
          </section>
        </div>
      </div>
    </DispatchShell>
  );
}
