import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconCopy,
  IconDatabase,
  IconFileSearch,
  IconInfoCircle,
  IconRefresh,
  IconSearch,
  IconTool,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { ActionQueryError } from "../../components/action-query-error";
import { DispatchShell } from "../../components/dispatch-shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
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

function runDiagnosis(run: RunFailureLike): {
  title: string;
  summary: string;
  nextStep: string;
  code: string;
} {
  const code =
    run.errorCode || run.terminalReason || run.abortReason || "unknown";
  if (code === "stale_run") {
    const workerStarted = run.dispatchMode === "background-processing";
    return {
      title: "Worker stopped reporting",
      summary: workerStarted
        ? "The worker claimed this run, then stopped writing heartbeat or progress signals before it finished. This is a liveness failure, not proof that the provider failed."
        : "The run stayed active until liveness recovery closed it. No completed result was recorded, so inspect the handoff and retained evidence before blaming a provider.",
      nextStep: workerStarted
        ? "Check the last worker stage and database heartbeat writes."
        : "Check the scheduled background handoff and whether a worker claimed it.",
      code,
    };
  }
  if (code === "background_worker_never_started") {
    return {
      title: "Background worker never started",
      summary:
        "The handoff was acknowledged, but no background worker claimed the run.",
      nextStep:
        "Check the background route, authentication, and function logs.",
      code,
    };
  }
  if (code === "background_worker_failed") {
    return {
      title: "Background worker failed during setup",
      summary:
        "The worker claimed the run but stopped before it could start the turn.",
      nextStep:
        "Use the recorded setup stage and worker logs to find the first failure.",
      code,
    };
  }
  if (code === "builder_gateway_network_error") {
    return {
      title: "Gateway stream ended early",
      summary:
        run.errorDetail ||
        "The model stream ended before the run emitted a terminal event.",
      nextStep:
        "Retry once; if it repeats, inspect gateway and provider transport health.",
      code,
    };
  }
  if (code === "aborted:user") {
    return {
      title: "Stopped by user",
      summary: "This run was explicitly aborted and is not a system failure.",
      nextStep: "No recovery action is required.",
      code,
    };
  }
  return {
    title: failureLabel(run),
    summary:
      run.errorDetail || "The run ended without a more specific explanation.",
    nextStep: "Open the timeline and inspect the last recorded stage or event.",
    code,
  };
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

function summarizeEvents(events: ThreadRun["events"]) {
  const toolNames = new Map<string, number>();
  let toolStarts = 0;
  for (const entry of events) {
    if (eventType(entry.event) !== "tool_start") continue;
    toolStarts += 1;
    const name = String(entry.event?.tool ?? "tool");
    toolNames.set(name, (toolNames.get(name) ?? 0) + 1);
  }
  return {
    toolStarts,
    toolNames: [...toolNames.entries()],
    meaningful: events.filter((entry) => !eventIsNoise(entry.event)).slice(-12),
  };
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

function DiagnosisPanel({
  run,
  eventCount,
  toolCount,
}: {
  run: ThreadRun;
  eventCount: number;
  toolCount: number;
}) {
  const diagnosis = runDiagnosis(run);
  const isStoppedByUser = diagnosis.code === "aborted:user";
  const isScheduled =
    run.id?.startsWith("job-") || run.dispatchMode === "background-processing";
  const workerClaimed = run.dispatchMode === "background-processing";
  const staleThreshold = isScheduled
    ? workerClaimed
      ? "45s after claim"
      : "90s before claim"
    : "15s";
  return (
    <section
      className={cn(
        "border-b px-5 py-4",
        isStoppedByUser ? "bg-muted/20" : "bg-destructive/[0.04]",
      )}
      aria-label="Run diagnosis"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            isStoppedByUser ? "bg-muted-foreground/50" : "bg-destructive",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {diagnosis.title}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {diagnosis.summary}
              </p>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {diagnosis.code}
            </span>
          </div>
          <div className="mt-3 flex items-start gap-2 text-xs text-foreground">
            <IconInfoCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium">Next check:</span>{" "}
              {diagnosis.nextStep}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        <EvidenceStat
          label="Run type"
          value={isScheduled ? "Scheduled job" : "Interactive chat"}
        />
        <EvidenceStat
          label="Worker claim"
          value={workerClaimed ? "Claimed" : "Not recorded"}
        />
        <EvidenceStat
          label="Last heartbeat"
          value={formatDate(run.heartbeatAt)}
        />
        <EvidenceStat
          label="Last progress"
          value={formatDate(run.lastProgressAt)}
        />
        <EvidenceStat label="Stale threshold" value={staleThreshold} />
        <EvidenceStat
          label="Recovery payload"
          value={run.hasDispatchPayload ? "Retained" : "Not retained"}
        />
        <EvidenceStat
          label="Worker stage"
          value={
            diagnosticStage(run.workerStage) ||
            diagnosticStage(run.diagStage) ||
            "Not recorded"
          }
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Evidence:{" "}
          <span className="font-medium text-foreground">
            {eventCount.toLocaleString()}
          </span>{" "}
          retained events
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <span className="font-medium text-foreground">
            {toolCount.toLocaleString()}
          </span>{" "}
          tool starts
        </span>
        <span aria-hidden="true">·</span>
        <span>Liveness uses the newer heartbeat or progress timestamp.</span>
      </div>
    </section>
  );
}

function RunTimeline({ run }: { run: ThreadRun }) {
  const summary = summarizeEvents(run.events);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-2">
          <IconActivity className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            {run.events.length.toLocaleString()} events retained
          </span>
          <span className="text-xs text-muted-foreground">
            {summary.toolStarts} tool starts
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          Started {formatDate(run.startedAt)}
        </span>
      </div>

      {summary.toolNames.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {summary.toolNames.map(([name, count]) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs text-foreground"
            >
              <IconTool className="size-3.5 text-muted-foreground" />
              {name} <span className="text-muted-foreground">×{count}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="divide-y rounded-lg border">
        {summary.meaningful.length > 0 ? (
          summary.meaningful.map((entry) => (
            <div
              key={`${run.id}-${entry.seq}`}
              className="flex items-start gap-3 px-3 py-2.5 text-xs"
            >
              <span className="w-8 shrink-0 font-mono text-muted-foreground">
                #{entry.seq}
              </span>
              <span className="min-w-0 flex-1 break-words text-foreground">
                {eventLabel(entry.event)}
              </span>
            </div>
          ))
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            No summarized events were retained for this run.
          </div>
        )}
      </div>

      <details className="rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-medium text-foreground">
          <span>Show raw event stream</span>
          <span className="font-normal text-muted-foreground">
            {run.events.length.toLocaleString()} records
          </span>
        </summary>
        <div className="space-y-2 border-t p-3">
          {run.events.map((entry) => (
            <details
              key={`${run.id}-raw-${entry.seq}`}
              className="rounded-md border bg-muted/20 px-3 py-2"
            >
              <summary className="cursor-pointer text-xs text-foreground">
                #{entry.seq} {eventLabel(entry.event)}
              </summary>
              <RawBlock value={entry.event} className="mt-2 max-h-72" />
            </details>
          ))}
        </div>
      </details>
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
  const primaryRun =
    detail.runs.find((run) => run.id === detail.lookup?.runId) ??
    detail.runs[0] ??
    null;
  const eventCount = detail.runs.reduce(
    (total, run) => total + run.events.length,
    0,
  );
  const toolCount = detail.runs.reduce(
    (total, run) => total + summarizeEvents(run.events).toolStarts,
    0,
  );

  return (
    <div className="min-w-0">
      <div className="border-b px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-foreground">
              {detail.thread.title || detail.thread.preview || detail.thread.id}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate font-mono">
                {detail.lookup?.runId || detail.thread.id}
              </span>
              {detail.lookup?.runId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  title="Copy run ID"
                  aria-label="Copy run ID"
                  onClick={() =>
                    void navigator.clipboard?.writeText(
                      detail.lookup?.runId ?? "",
                    )
                  }
                >
                  <IconCopy className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {primaryRun ? (
              <Badge
                variant={
                  primaryRun.status === "errored" ? "destructive" : "secondary"
                }
              >
                {primaryRun.status}
              </Badge>
            ) : null}
            <Badge variant="outline">{detail.source.label}</Badge>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="truncate">{detail.thread.ownerEmail}</span>
          <span aria-hidden="true">·</span>
          <span>{detail.messages.length} messages</span>
          <span aria-hidden="true">·</span>
          <span>{detail.runs.length} runs</span>
          <span aria-hidden="true">·</span>
          <span>updated {formatDate(detail.thread.updatedAt)}</span>
        </div>
      </div>

      {primaryRun ? (
        <DiagnosisPanel
          run={primaryRun}
          eventCount={eventCount}
          toolCount={toolCount}
        />
      ) : null}

      <Tabs defaultValue="overview" className="p-5">
        <TabsList className="h-9">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="technical">Technical</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="flex items-start gap-2 border-b pb-4 text-sm text-muted-foreground">
            <IconInfoCircle className="mt-0.5 size-4 shrink-0" />
            <p className="max-w-2xl leading-relaxed">
              This is the compact readout. Open Timeline for the last meaningful
              signals, Transcript for persisted messages and tool calls, or
              Technical for raw records.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <EvidenceStat
              label="Created"
              value={formatDate(detail.thread.createdAt)}
            />
            <EvidenceStat
              label="Updated"
              value={formatDate(detail.thread.updatedAt)}
            />
            <EvidenceStat label="Source" value={detail.source.label} />
            <EvidenceStat
              label="Messages"
              value={detail.messages.length.toLocaleString()}
            />
            <EvidenceStat
              label="Retained events"
              value={eventCount.toLocaleString()}
            />
            <EvidenceStat
              label="Tool starts"
              value={toolCount.toLocaleString()}
            />
          </div>
          {detail.messages.length === 0 && eventCount > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              <IconActivity className="mt-0.5 size-4 shrink-0" />
              <span>
                No persisted messages are available, but this run retained{" "}
                {eventCount.toLocaleString()} execution events. The timeline is
                the authoritative audit trail for this run.
              </span>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="timeline" className="mt-4 space-y-5">
          {detail.runs.length > 0 ? (
            detail.runs.map((run) => (
              <section
                key={run.id}
                className="border-b pb-5 last:border-b-0 last:pb-0"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      run.status === "errored" ? "destructive" : "outline"
                    }
                  >
                    {run.status}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {run.id}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(run.durationMs)}
                  </span>
                </div>
                <RunTimeline run={run} />
              </section>
            ))
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No retained runs.
            </div>
          )}
        </TabsContent>

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
              <div>No persisted messages.</div>
              {eventCount > 0 ? (
                <div className="mt-1">
                  Open Timeline to audit the retained execution events.
                </div>
              ) : null}
            </div>
          )}
        </TabsContent>

        <TabsContent value="technical" className="mt-4 space-y-3">
          <details className="rounded-lg border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-foreground">
              <span>Run records</span>
              <span className="text-xs font-normal text-muted-foreground">
                {detail.runs.length} {detail.runs.length === 1 ? "run" : "runs"}
              </span>
            </summary>
            <div className="space-y-4 border-t p-3">
              {detail.runs.length > 0 ? (
                detail.runs.map((run) => (
                  <div key={run.id} className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          run.status === "errored" ? "destructive" : "outline"
                        }
                      >
                        {run.status}
                      </Badge>
                      <span className="break-all font-mono text-xs text-foreground">
                        {run.id}
                      </span>
                    </div>
                    <div className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
                      <EvidenceStat
                        label="Failure code"
                        value={run.errorCode || "n/a"}
                      />
                      <EvidenceStat
                        label="Terminal reason"
                        value={run.terminalReason || run.abortReason || "n/a"}
                      />
                      <EvidenceStat
                        label="Dispatch mode"
                        value={run.dispatchMode || "foreground"}
                      />
                      <EvidenceStat
                        label="Last stage"
                        value={
                          diagnosticStage(run.workerStage) ||
                          diagnosticStage(run.diagStage) ||
                          "n/a"
                        }
                      />
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
                        value={formatDate(
                          run.lastProgressAt ?? run.heartbeatAt,
                        )}
                      />
                      <EvidenceStat
                        label="In-flight marker"
                        value={formatDate(run.inFlightSince)}
                      />
                      <EvidenceStat
                        label="Recovery payload"
                        value={
                          run.hasDispatchPayload ? "retained" : "not retained"
                        }
                      />
                    </div>
                    {run.errorDetail ? (
                      <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                        {run.errorDetail}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">
                  No retained run records.
                </div>
              )}
            </div>
          </details>

          <details className="rounded-lg border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-foreground">
              <span>Traces, feedback, and evaluations</span>
              <span className="text-xs font-normal text-muted-foreground">
                diagnostic records
              </span>
            </summary>
            <div className="grid gap-4 border-t p-3 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium text-foreground">
                  Debug runs
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
                <div className="mb-2 text-xs font-medium text-foreground">
                  Trace summaries
                </div>
                <RawBlock value={detail.traces.summaries} />
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-foreground">
                  Trace spans
                </div>
                <RawBlock value={detail.traces.spans} />
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-foreground">
                  Feedback and evals
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
          </details>

          <details className="rounded-lg border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-foreground">
              <span>Raw thread bundle</span>
              <span className="text-xs font-normal text-muted-foreground">
                JSON
              </span>
            </summary>
            <div className="space-y-3 border-t p-3">
              <RawBlock value={rawBundle} />
              <RawBlock value={detail.rawThreadData} />
            </div>
          </details>
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
  const regime = parseFailureRegime(routeSearchParams.get("regime"));
  const range = parseFailureRange(routeSearchParams.get("range"));
  const runId = routeSearchParams.get("runId") || "";
  const threadId = routeSearchParams.get("threadId") || "";
  const inspectSourceId = routeSearchParams.get("inspectSource") || "";
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
        <ThreadDetail detail={detail} />
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
        </Tabs>
      </div>
    </DispatchShell>
  );
}
