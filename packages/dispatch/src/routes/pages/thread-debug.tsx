import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconArrowLeft,
  IconCopy,
  IconDatabase,
  IconFileSearch,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconTool,
  IconUser,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { ActionQueryError } from "../../components/action-query-error";
import { DispatchShell } from "../../components/dispatch-shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../../components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import {
  buildConversationRows,
  defaultConversationRowKey,
  type ConversationRow,
} from "../../lib/thread-debug-conversation";
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
  inFlightSince?: number | null;
  hasDispatchPayload?: boolean;
  events: Array<{ seq: number; event: any; rawEventData: string }>;
}

type ThreadDebugMode = "failures" | "threads";
type FailureStatus = "all" | "errored" | "aborted" | "truncated";
type FailureRegime = "all" | "interactive" | "scheduled";
type FailureRange = "24h" | "7d" | "30d";

interface FailureTaxonomy {
  code: string;
  label: string;
  regime: "interactive" | "scheduled";
  source: "error_code" | "error_detail" | "unknown";
}

interface RunFailureLike {
  id?: string;
  status?: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  terminalReason?: string | null;
  abortReason?: string | null;
  dispatchMode?: string | null;
  diagStage?: string | null;
  workerStage?: string | null;
  durationMs?: number | null;
  heartbeatAt?: number | null;
  lastProgressAt?: number | null;
}

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
  turnId?: string | null;
  threadTitle: string;
  threadPreview: string;
  status: string;
  errorCode: string | null;
  errorDetail: string | null;
  terminalReason: string | null;
  abortReason: string | null;
  heartbeatAt?: number | null;
  lastProgressAt?: number | null;
  dispatchMode: string | null;
  diagStage: string | null;
  workerStage?: string | null;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  regime?: "interactive" | "scheduled";
  failureTaxonomy?: FailureTaxonomy;
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

const EMPTY_FAILURES: AgentRunFailure[] = [];

function parseMode(value: string | null): ThreadDebugMode {
  return value === "threads" ? "threads" : "failures";
}

function parseFailureStatus(value: string | null): FailureStatus {
  return value === "errored" || value === "aborted" || value === "truncated"
    ? value
    : "all";
}

function parseFailureRegime(value: string | null): FailureRegime {
  return value === "interactive" || value === "scheduled" ? value : "all";
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

function isTechnicalIdentifier(value: string): boolean {
  return /^(?:job|run|thread|turn|request|req)-[a-z0-9][a-z0-9_-]*$/i.test(
    value.trim(),
  );
}

function displayListTitle(
  value: string | null | undefined,
  fallbackValue: string | null | undefined,
  fallbackLabel: string,
): string {
  const candidate = [value, fallbackValue]
    .map((entry) => entry?.trim() || "")
    .find((entry) => entry && !isTechnicalIdentifier(entry));
  if (!candidate) return fallbackLabel;

  const withoutDate = candidate
    .replace(/\s+[—-]\s+\d{1,2}\/\d{1,2}\/\d{4}\s*$/, "")
    .trim();
  if (!withoutDate) return fallbackLabel;

  if (/^job:/i.test(withoutDate)) {
    return withoutDate
      .replace(/^job:\s*/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase())
      .trim();
  }

  return withoutDate;
}

function formatDate(value: number | string | null | undefined): string {
  if (value == null || value === "") return "n/a";
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function formatRelativeDate(value: number | string | null | undefined): string {
  if (value == null || value === "") return "n/a";
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric)
    ? numeric
    : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "n/a";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 0) return "in a moment";
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

function formatDuration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}

function humanizeIdentifier(value: string | null | undefined): string {
  if (!value) return "Unknown failure";
  return value
    .replace(/^(error:|failure:)/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function failureLabel(run: RunFailureLike): string {
  const code = run.errorCode || run.terminalReason || run.abortReason;
  const labels: Record<string, string> = {
    stale_run: "Worker heartbeat stopped",
    background_worker_never_started: "Background worker never started",
    background_worker_failed: "Background worker setup failed",
    builder_gateway_network_error: "Gateway stream ended early",
    provider_timeout: "Provider timed out",
    provider_network_error: "Provider connection dropped",
    provider_config_error: "Provider configuration rejected",
    authentication_error: "Provider authentication failed",
    overloaded_error: "Provider was overloaded",
    "aborted:user": "Stopped by user",
  };
  return (code && labels[code]) || humanizeIdentifier(code);
}

const DIAGNOSIS_TITLES: Record<string, string> = {
  stale_run: "Worker stopped reporting",
  background_worker_failed: "Background worker failed during setup",
};

function runDiagnosis(run: RunFailureLike): { title: string; code: string } {
  const code =
    run.errorCode || run.terminalReason || run.abortReason || "unknown";
  return { title: DIAGNOSIS_TITLES[code] ?? failureLabel(run), code };
}

function eventType(event: any): string {
  return typeof event?.type === "string" ? event.type : "event";
}

function eventIsNoise(event: any): boolean {
  return [
    "thinking",
    "text",
    "tool_input_delta",
    "stream_keepalive",
    "activity",
  ].includes(eventType(event));
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

function ResultCard({
  result,
  selected,
  onSelect,
}: {
  result: ThreadSearchResult;
  selected: boolean;
  onSelect: () => void;
}) {
  const title = displayListTitle(
    result.title,
    result.preview,
    "Untitled thread",
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group w-full border-b px-4 py-3 text-left transition-colors last:border-b-0",
        selected ? "bg-accent/70" : "hover:bg-muted/50",
      )}
    >
      <div className="truncate text-sm font-medium text-foreground">
        {title}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {result.messageCount}{" "}
          {result.messageCount === 1 ? "message" : "messages"}
        </span>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate">{result.ownerEmail}</span>
        <span aria-hidden="true">·</span>
        <span>{formatRelativeDate(result.updatedAt)}</span>
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
  const diagnosis = runDiagnosis(failure);
  const title = displayListTitle(
    failure.threadTitle,
    failure.threadPreview,
    "Agent run",
  );
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
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group w-full border-b px-4 py-3 text-left transition-[background-color,border-color] last:border-b-0",
        selected ? "bg-accent/70" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            failure.status === "aborted"
              ? "bg-muted-foreground/50"
              : "bg-destructive",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {title}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {failureSourceLabel(failure)}
              </div>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatRelativeDate(failure.completedAt ?? failure.startedAt)}
            </span>
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-2 text-xs">
            <span className="truncate font-medium text-foreground">
              {diagnosis.title}
            </span>
            <span className="shrink-0 text-muted-foreground">·</span>
            <span className="shrink-0 text-muted-foreground">
              {statusLabel}
            </span>
          </div>
          {failure.durationMs == null ? null : (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {formatDuration(failure.durationMs)}
            </div>
          )}
        </div>
      </div>
      <span className="sr-only">
        {t("dispatch.pages.threadDebugInspectFailure", {
          defaultValue: "Inspect failed run",
        })}
      </span>
    </button>
  );
}

function toolCounts(message: ThreadMessage): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const tool of toolParts(message)) {
    const name = String(tool.toolName ?? tool.name ?? "tool-call");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()];
}

function EvidenceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

function runFailed(run: ThreadRun): boolean {
  return (
    run.status !== "completed" &&
    run.status !== "running" &&
    (run.terminalReason || run.abortReason) !== "user"
  );
}

// Runs that fail before the model starts (run_preparation_failed,
// background_worker_never_started) retain no events, so the run row's own
// terminal fields are the only record of how they ended.
function RunOutcome({ run, needle = "" }: { run: ThreadRun; needle?: string }) {
  const reason = run.terminalReason || run.abortReason;
  const codes = [
    ...new Set(
      [reason, run.errorCode].filter((code): code is string => Boolean(code)),
    ),
  ];
  const stage =
    diagnosticStage(run.workerStage) || diagnosticStage(run.diagStage);
  const failed = runFailed(run);
  return (
    <div className="min-w-0 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            "font-medium",
            failed ? "text-destructive" : "text-foreground",
          )}
        >
          <Highlighted text={run.status} needle={needle} />
        </span>
        {codes.map((code) => (
          <span key={code} className="font-mono text-muted-foreground">
            <Highlighted text={code} needle={needle} />
          </span>
        ))}
      </div>
      {run.errorDetail ? (
        <div className="whitespace-pre-wrap break-words text-foreground">
          <Highlighted text={run.errorDetail} needle={needle} />
        </div>
      ) : null}
      {stage ? (
        <div className="text-muted-foreground">Last stage: {stage}</div>
      ) : null}
    </div>
  );
}

type ThreadRow = ConversationRow<ThreadMessage, ThreadRun>;

const SNIPPET_LEAD_CHARS = 60;

// Rows clamp to three lines, so a match deep in a long message would be
// highlighted out of view; start the preview shortly before the first match.
function matchPreview(text: string, needle: string): string {
  const index = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (index <= SNIPPET_LEAD_CHARS) return text;
  const start = text.lastIndexOf(" ", index - SNIPPET_LEAD_CHARS) + 1;
  return `…${text.slice(start)}`;
}

function Highlighted({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(needle);
  while (index !== -1) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <mark
        key={index}
        className="rounded-sm bg-[hsl(var(--dispatch-search-match))] px-0.5 text-foreground"
      >
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function ConversationRowButton({
  row,
  selected,
  needle,
  onSelect,
}: {
  row: ThreadRow;
  selected: boolean;
  needle: string;
  onSelect: () => void;
}) {
  const run = row.run;
  const failed = run ? runFailed(run) : false;
  const isUser = row.kind === "message" && row.message.role === "user";
  const Icon =
    row.kind === "run" ? IconAlertTriangle : isUser ? IconUser : IconRobot;
  const tools = row.kind === "message" ? toolCounts(row.message) : [];
  const showOutcome =
    run && (row.kind === "run" || (!isUser && run.status !== "completed"));
  const time =
    row.kind === "message" ? row.message.createdAt : (run?.startedAt ?? null);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0",
        selected ? "bg-accent/70" : "hover:bg-muted/50",
        row.kind === "run" && failed && !selected && "bg-destructive/[0.04]",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          row.kind === "run" && failed
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">
            {row.kind === "run" ? "Run" : isUser ? "User" : "Agent"}
          </span>
          <span className="shrink-0">{formatDate(time)}</span>
        </div>
        {row.kind === "message" ? (
          row.message.text ? (
            <div className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground">
              <Highlighted
                text={matchPreview(row.message.text, needle)}
                needle={needle}
              />
            </div>
          ) : tools.length === 0 ? (
            <div className="text-sm text-muted-foreground">No text content</div>
          ) : null
        ) : null}
        {tools.length > 0 || (!isUser && run?.durationMs != null) ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {tools.map(([name, count]) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-foreground"
              >
                <IconTool className="size-3 text-muted-foreground" />
                <Highlighted text={name} needle={needle} />
                {count > 1 ? (
                  <span className="text-muted-foreground">×{count}</span>
                ) : null}
              </span>
            ))}
            {!isUser && run?.durationMs != null ? (
              <span className="text-muted-foreground">
                {formatDuration(run.durationMs)}
              </span>
            ) : null}
          </div>
        ) : null}
        {showOutcome && run ? <RunOutcome run={run} needle={needle} /> : null}
      </div>
    </button>
  );
}

function RunRecord({ run }: { run: ThreadRun }) {
  return (
    <div className="space-y-4">
      <RunOutcome run={run} />
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <EvidenceStat label="Run ID" value={run.id} />
        <EvidenceStat
          label="Dispatch mode"
          value={run.dispatchMode || "foreground"}
        />
        <EvidenceStat label="Started" value={formatDate(run.startedAt)} />
        <EvidenceStat
          label="Duration"
          value={formatDuration(
            run.durationMs ??
              (run.completedAt == null
                ? null
                : run.completedAt - run.startedAt),
          )}
        />
        <EvidenceStat
          label="Last progress"
          value={formatDate(run.lastProgressAt ?? run.heartbeatAt)}
        />
        <EvidenceStat
          label="In-flight marker"
          value={formatDate(run.inFlightSince)}
        />
        <EvidenceStat
          label="Recovery payload"
          value={run.hasDispatchPayload ? "retained" : "not retained"}
        />
      </div>
      <RawBlock
        value={Object.fromEntries(
          Object.entries(run).filter(([key]) => key !== "events"),
        )}
      />
    </div>
  );
}

function RunEvents({ run }: { run: ThreadRun }) {
  const [showStream, setShowStream] = useState(false);
  const switchId = `thread-debug-stream-${run.id}`;
  const events = showStream
    ? run.events
    : run.events.filter((entry) => !eventIsNoise(entry.event));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={showStream}
          onCheckedChange={setShowStream}
        />
        <Label htmlFor={switchId} className="text-xs font-normal">
          Show stream events
        </Label>
      </div>
      {events.length > 0 ? (
        <div className="space-y-2">
          {events.map((entry) => (
            <details
              key={`${run.id}-event-${entry.seq}`}
              className="rounded-md border bg-muted/20 px-3 py-2"
            >
              <summary className="cursor-pointer text-xs text-foreground">
                <span className="font-mono text-muted-foreground">
                  #{entry.seq}
                </span>{" "}
                {eventLabel(entry.event)}
              </summary>
              <RawBlock value={entry.event} className="mt-2 max-h-72" />
            </details>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          No events were retained for this run.
        </div>
      )}
    </div>
  );
}

type InspectorTab = "message" | "run" | "events" | "traces";

const THREAD_ITEM = "thread";

function ThreadRecords({ detail }: { detail: ThreadDebugResponse }) {
  const threadBundle = useMemo(
    () => ({
      thread: detail.thread,
      debug: detail.debug,
      debugRuns: detail.debugRuns,
      queuedMessages: detail.queuedMessages,
      feedback: detail.feedback,
      satisfaction: detail.satisfaction,
      evals: detail.evals,
      checkpoints: detail.checkpoints,
    }),
    [detail],
  );
  return (
    <div className="space-y-3 p-4">
      <RawBlock value={threadBundle} />
      <RawBlock value={detail.rawThreadData} />
    </div>
  );
}

// A user prompt and the agent reply to it share one run. The run belongs to
// the reply (or to a run row when there was no reply); repeating it on the
// prompt makes two different rows look identical in the inspector.
function inspectedRun(row: ThreadRow): ThreadRun | null {
  if (row.kind === "run") return row.run;
  return row.message.role === "user" ? null : row.run;
}

function RowInspector({
  row,
  detail,
}: {
  row: ThreadRow;
  detail: ThreadDebugResponse;
}) {
  const [tab, setTab] = useState<InspectorTab>("message");
  const run = inspectedRun(row);
  const available: InspectorTab[] = [
    ...(row.kind === "message" ? (["message"] as const) : []),
    ...(run ? (["run", "events", "traces"] as const) : []),
  ];
  const activeTab = available.includes(tab) ? tab : available[0];
  const traces = useMemo(() => {
    if (!run) return { summaries: [], spans: [] };
    const forRun = (record: any) => record?.run_id === run.id;
    return {
      summaries: detail.traces.summaries.filter(forRun),
      spans: detail.traces.spans.filter(forRun),
    };
  }, [detail.traces, run]);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setTab(value as InspectorTab)}
      className="p-4"
    >
      <TabsList>
        {row.kind === "message" ? (
          <TabsTrigger value="message">Message</TabsTrigger>
        ) : null}
        {run ? (
          <>
            <TabsTrigger value="run">Run</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="traces">Traces</TabsTrigger>
          </>
        ) : null}
      </TabsList>

      {row.kind === "message" ? (
        <TabsContent value="message" className="mt-4 space-y-3">
          {toolParts(row.message).map((tool, index) => (
            <details
              key={`${row.key}-tool-${index}`}
              className="rounded-md border bg-muted/30 px-3 py-2"
            >
              <summary className="cursor-pointer text-xs font-medium text-foreground">
                {tool.toolName ?? tool.name ?? "tool-call"}
              </summary>
              <RawBlock value={tool} className="mt-2 max-h-72" />
            </details>
          ))}
          <RawBlock value={row.message} />
        </TabsContent>
      ) : null}
      {run ? (
        <>
          <TabsContent value="run" className="mt-4">
            <RunRecord run={run} />
          </TabsContent>
          <TabsContent value="events" className="mt-4">
            <RunEvents key={run.id} run={run} />
          </TabsContent>
          <TabsContent value="traces" className="mt-4 space-y-3">
            {traces.summaries.length > 0 || traces.spans.length > 0 ? (
              <>
                <RawBlock value={traces.summaries} />
                <RawBlock value={traces.spans} />
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                No traces were recorded for this run.
              </div>
            )}
          </TabsContent>
        </>
      ) : null}
    </Tabs>
  );
}

function rowMatches(row: ThreadRow, needle: string): boolean {
  const run = row.kind === "run" ? row.run : null;
  const haystack = [
    row.kind === "message" ? row.message.text : "",
    ...(row.kind === "message"
      ? toolCounts(row.message).map(([name]) => name)
      : []),
    row.run?.status,
    row.run?.terminalReason,
    row.run?.abortReason,
    row.run?.errorCode,
    row.run?.errorDetail,
    run?.id,
  ];
  return haystack.some(
    (value) =>
      typeof value === "string" && value.toLowerCase().includes(needle),
  );
}

function ThreadDetail({
  detail,
  selectedRowKey,
  onSelectRow,
  onBack,
}: {
  detail: ThreadDebugResponse;
  selectedRowKey: string | null;
  onSelectRow: (key: string) => void;
  onBack?: () => void;
}) {
  const rows = useMemo(
    () => buildConversationRows(detail.messages, detail.runs),
    [detail.messages, detail.runs],
  );
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const visibleRows = needle
    ? rows.filter((row) => rowMatches(row, needle))
    : rows;
  const showThread = selectedRowKey === THREAD_ITEM;
  const activeKey = showThread
    ? null
    : (rows.find((row) => row.key === selectedRowKey)?.key ??
      defaultConversationRowKey(rows, detail.lookup?.runId));
  const selectedRow = rows.find((row) => row.key === activeKey) ?? null;
  const lookupRun =
    detail.runs.find((run) => run.id === detail.lookup?.runId) ?? null;

  return (
    <div className="min-w-0">
      <div className="flex items-start gap-2 border-b px-5 py-4">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-2 size-8 shrink-0"
            aria-label="Back to threads"
            title="Back to threads"
            onClick={onBack}
          >
            <IconArrowLeft className="size-4" />
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-foreground">
              {detail.thread.title || detail.thread.preview || detail.thread.id}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="truncate">{detail.thread.ownerEmail}</span>
              <span aria-hidden="true">·</span>
              <span>updated {formatDate(detail.thread.updatedAt)}</span>
              <span aria-hidden="true">·</span>
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono">
                  {detail.lookup?.runId || detail.thread.id}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  title={
                    detail.lookup?.runId ? "Copy run ID" : "Copy thread ID"
                  }
                  aria-label={
                    detail.lookup?.runId ? "Copy run ID" : "Copy thread ID"
                  }
                  onClick={() =>
                    void navigator.clipboard?.writeText(
                      detail.lookup?.runId || detail.thread.id,
                    )
                  }
                >
                  <IconCopy className="size-3.5" />
                </Button>
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={showThread ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={showThread}
              onClick={() => onSelectRow(showThread ? "" : THREAD_ITEM)}
            >
              <IconDatabase className="size-4" />
              Thread data
            </Button>
            {lookupRun ? (
              <Badge
                variant={
                  lookupRun.status === "errored" ? "destructive" : "secondary"
                }
              >
                {lookupRun.status}
              </Badge>
            ) : null}
            <Badge variant="outline">{detail.source.label}</Badge>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2">
        <section
          aria-label="Conversation"
          className="max-h-[760px] min-w-0 overflow-auto border-b lg:border-b-0 lg:border-r"
        >
          {rows.length > 0 ? (
            <div className="sticky top-0 z-10 border-b bg-card p-2">
              <div className="relative">
                <IconSearch
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search messages"
                  aria-label="Search messages"
                  className="h-8 pl-8"
                />
              </div>
            </div>
          ) : null}
          {visibleRows.map((row) => (
            <ConversationRowButton
              key={row.key}
              row={row}
              selected={row.key === activeKey}
              needle={needle}
              onSelect={() => onSelectRow(row.key)}
            />
          ))}
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No messages or runs were retained for this thread.
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No matching messages.
            </div>
          ) : null}
        </section>
        <section
          aria-label="Inspector"
          className="max-h-[760px] min-w-0 overflow-auto"
        >
          {showThread ? (
            <ThreadRecords detail={detail} />
          ) : selectedRow ? (
            <RowInspector row={selectedRow} detail={detail} />
          ) : null}
        </section>
      </div>
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
  const regime = parseFailureRegime(routeSearchParams.get("regime"));
  const range = parseFailureRange(routeSearchParams.get("range"));
  const runId = routeSearchParams.get("runId") || "";
  const threadId = routeSearchParams.get("threadId") || "";
  const inspectSourceId = routeSearchParams.get("inspectSource") || "";
  const selectedItem = routeSearchParams.get("item");
  const [lookupId, setLookupId] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

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
  const { data: sourcesData } = sourcesQuery;

  const sources: ThreadDebugSource[] = sourcesData?.sources ?? [];
  const failureParams = useMemo(
    () => ({
      sourceId,
      ownerEmail: ownerEmail.trim() || undefined,
      status,
      regime,
      lookbackHours: FAILURE_RANGE_HOURS[range],
      limit: 25,
    }),
    [ownerEmail, range, regime, sourceId, status],
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
  const failures = failuresData?.failures ?? EMPTY_FAILURES;
  const failurePatterns = useMemo(() => {
    const patterns = new Map<string, { label: string; count: number }>();
    for (const failure of failures) {
      const diagnosis = runDiagnosis(failure);
      const current = patterns.get(diagnosis.code);
      patterns.set(diagnosis.code, {
        label: diagnosis.title,
        count: (current?.count ?? 0) + 1,
      });
    }
    return [...patterns.values()].sort((a, b) => b.count - a.count);
  }, [failures]);
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
      limit: 25,
    }),
    [query, threadSourceId],
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
  const ownerEmailSuggestions = useMemo(() => {
    const emailQuery = query.trim().includes("@")
      ? query.trim().toLowerCase()
      : "";
    return [...new Set(searchThreads.map((thread) => thread.ownerEmail))]
      .filter(
        (email) => !emailQuery || email.toLowerCase().includes(emailQuery),
      )
      .slice(0, 8);
  }, [query, searchThreads]);

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

  const detailPane = (
    <section className="min-w-0">
      {detailError ? (
        <ActionQueryError
          error={detailError}
          onRetry={() => void refetchDetail()}
        />
      ) : null}
      {detailLoading ? (
        <div className="p-5">
          <Skeleton className="h-6 w-72" />
          <Skeleton className="mt-3 h-4 w-96" />
          <Skeleton className="mt-6 h-[520px] w-full" />
        </div>
      ) : detail ? (
        <ThreadDetail
          detail={detail}
          selectedRowKey={selectedItem}
          onSelectRow={(key) => updateRouteState({ item: key })}
          onBack={
            mode === "threads"
              ? () =>
                  updateRouteState({
                    threadId: null,
                    runId: null,
                    inspectSource: null,
                    item: null,
                  })
              : undefined
          }
        />
      ) : (
        <div className="flex min-h-[520px] flex-col items-center justify-center px-5 text-center text-sm text-muted-foreground">
          <IconFileSearch className="mb-2 size-5" />
          <div className="font-medium text-foreground">
            Choose a run to inspect
          </div>
          <div className="mt-1 max-w-xs leading-relaxed">
            See the diagnosis first, then open the timeline or technical
            evidence.
          </div>
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
        defaultValue: "Find the failure pattern, then inspect the evidence.",
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
            <section className="border-b pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Run health
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Start with the dominant failure pattern, then open one run.
                  </p>
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
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-[200px_minmax(180px,1fr)_180px_160px_150px]">
                <Select
                  value={sourceId}
                  onValueChange={(value) =>
                    updateRouteState({
                      source: value,
                      runId: null,
                      threadId: null,
                      inspectSource: null,
                      item: null,
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
                  aria-label={t("dispatch.pages.threadDebugOwner", {
                    defaultValue: "Owner email",
                  })}
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
                  value={regime}
                  onValueChange={(value) =>
                    updateRouteState({
                      regime: parseFailureRegime(value),
                      runId: null,
                      inspectSource: null,
                    })
                  }
                >
                  <SelectTrigger aria-label="Run type">
                    <SelectValue placeholder="Run type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All run types</SelectItem>
                    <SelectItem value="interactive">
                      Interactive chats
                    </SelectItem>
                    <SelectItem value="scheduled">Scheduled jobs</SelectItem>
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
              {failuresData?.partial ? (
                <div className="mt-2">
                  <Badge variant="outline">
                    {t("dispatch.pages.threadDebugPartialResults", {
                      defaultValue: "Partial results",
                    })}
                  </Badge>
                </div>
              ) : null}
            </section>

            {failuresError ? (
              <ActionQueryError
                error={failuresError}
                onRetry={() => void refetchFailures()}
              />
            ) : null}

            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="grid xl:grid-cols-[360px_minmax(0,1fr)]">
                <section className="min-h-[560px] border-b xl:border-b-0 xl:border-r">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        Needs attention
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {failurePatterns[0]
                          ? `${failurePatterns[0].count} ${failurePatterns[0].label.toLowerCase()}`
                          : "No active failure pattern"}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {failures.length}
                    </span>
                  </div>
                  <div className="max-h-[760px] overflow-auto">
                    {failuresLoading ? (
                      <>
                        <Skeleton className="mx-4 mt-4 h-16 w-[calc(100%-2rem)]" />
                        <Skeleton className="mx-4 mt-2 h-16 w-[calc(100%-2rem)]" />
                        <Skeleton className="mx-4 mt-2 h-16 w-[calc(100%-2rem)]" />
                      </>
                    ) : null}
                    {!failuresLoading && failures.length === 0 ? (
                      <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground">
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
                            item: null,
                          })
                        }
                      />
                    ))}
                  </div>
                </section>
                <div className="min-w-0">{detailPane}</div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="threads" className="mt-4 space-y-4">
            <section className="border-b pb-4">
              <div className="grid gap-2 pt-3 lg:grid-cols-2 xl:grid-cols-[auto_180px_minmax(220px,1fr)_auto_auto]">
                <Select
                  value={threadSourceId}
                  onValueChange={(value) =>
                    updateRouteState({
                      source: value,
                      runId: null,
                      threadId: null,
                      inspectSource: null,
                      item: null,
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
                <Popover
                  open={searchFocused && ownerEmailSuggestions.length > 0}
                  onOpenChange={setSearchFocused}
                >
                  <PopoverAnchor asChild>
                    <span className="block">
                      <Input
                        value={query}
                        onChange={(event) =>
                          updateRouteState({ query: event.target.value })
                        }
                        onFocus={() => setSearchFocused(true)}
                        placeholder={t(
                          "dispatch.pages.threadDebugSearchPlaceholder",
                          {
                            defaultValue: "Search threads or email",
                          },
                        )}
                        aria-label="Search threads or email"
                      />
                    </span>
                  </PopoverAnchor>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    className="w-[var(--radix-popover-trigger-width)] p-1"
                    onOpenAutoFocus={(event) => event.preventDefault()}
                  >
                    <div role="listbox" aria-label="Owner email suggestions">
                      {ownerEmailSuggestions.map((email) => (
                        <button
                          key={email}
                          type="button"
                          role="option"
                          aria-selected="false"
                          className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm text-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            updateRouteState({ query: email });
                            setSearchFocused(false);
                          }}
                        >
                          {email}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void refetchSearch()}
                  aria-label="Search threads or email"
                  title="Search threads or email"
                >
                  <IconSearch className="size-4" />
                </Button>
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
                <details className="order-first justify-self-start rounded-lg border">
                  <summary
                    aria-label="Advanced lookup"
                    title="Advanced lookup"
                    className="flex size-10 cursor-pointer list-none items-center justify-center text-foreground"
                  >
                    <IconAdjustmentsHorizontal
                      aria-hidden="true"
                      className="size-4"
                    />
                    <span className="sr-only">Advanced lookup</span>
                  </summary>
                  <div className="grid gap-3 border-t p-3 lg:w-80">
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
                                item: null,
                              }
                            : {
                                threadId: trimmed,
                                runId: null,
                                inspectSource: null,
                                item: null,
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
                </details>
              </div>
            </section>

            {searchError ? (
              <ActionQueryError
                error={searchError}
                onRetry={() => void refetchSearch()}
              />
            ) : null}

            <div className="overflow-hidden rounded-xl border bg-card">
              {runId || threadId ? (
                detailPane
              ) : (
                <div className="grid xl:grid-cols-[360px_minmax(0,1fr)]">
                  <section className="min-h-[560px] border-b xl:border-b-0 xl:border-r">
                    <div className="max-h-[760px] overflow-auto">
                      {searchLoading ? (
                        <>
                          <Skeleton className="mx-4 mt-4 h-16 w-[calc(100%-2rem)]" />
                          <Skeleton className="mx-4 mt-2 h-16 w-[calc(100%-2rem)]" />
                          <Skeleton className="mx-4 mt-2 h-16 w-[calc(100%-2rem)]" />
                        </>
                      ) : null}
                      {!searchLoading && searchThreads.length === 0 ? (
                        <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground">
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
                              item: null,
                            })
                          }
                        />
                      ))}
                    </div>
                  </section>
                  <div className="min-w-0">{detailPane}</div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DispatchShell>
  );
}
