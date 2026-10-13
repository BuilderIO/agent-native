import {
  getBackgroundAgentSessionStatus,
  startBackgroundAgentSession,
  type BackgroundAgentSessionReceipt,
  type BackgroundAgentSessionSnapshot,
  type BackgroundAgentSessionStartOptions,
} from "@agent-native/core/client/agent-chat";
import {
  bumpChangeVersion,
  callAction,
  getChangeVersion,
  useActionQuery,
  useChangeVersion,
} from "@agent-native/core/client/hooks";
import {
  aiRequestTabId,
  type AutoTitleCandidate,
  type ClipsAiRequestKind,
} from "@shared/ai-request-status";
import { fullVideoAiModelSelection } from "@shared/clips-ai-prefs";
import { parseTranscriptSegments } from "@shared/transcript-segments";
import { useEffect, useRef } from "react";

const TWO_MINUTES_MS = 2 * 60 * 1000;
export const WORKFLOW_ACTION_MAX_ATTEMPTS = 5;
const WORKFLOW_ACTION_RETRY_DELAY_MS = 1000;
// `queueAiRequest` publishes `refresh-signal` after every queue, whoever the
// writer is. Sync drops this tab's own events, so local queues bump it too.
const AI_REQUEST_REFRESH_SOURCE = "app-state:refresh-signal";
const AI_REQUEST_RETRY_INITIAL_DELAY_MS = 1_000;
const AI_REQUEST_RETRY_MAX_DELAY_MS = 30_000;
const BACKGROUND_SESSION_POLL_INTERVAL_MS = 2_000;
export const BACKGROUND_SESSION_MISSING_CONFIRMATION_MS = 3 * 60 * 1000;

function bumpAiRequestRefresh(): void {
  bumpChangeVersion(
    AI_REQUEST_REFRESH_SOURCE,
    Math.max(Date.now(), getChangeVersion(AI_REQUEST_REFRESH_SOURCE) + 1),
  );
}

export function notifyAiRequestQueued(recordingId: string): void {
  if (!recordingId) return;
  bumpAiRequestRefresh();
}

interface AiRequest {
  kind?: string;
  recordingId?: string;
  requestedAt?: string;
  requestId?: string;
  currentTitle?: string;
  currentDescription?: string;
  transcriptStatus?: string;
  transcriptText?: string;
  segmentsJson?: string;
  agentsContext?: string;
  includeSummary?: boolean;
  thresholdMs?: number;
  message?: string;
  includeFullVideoInAi?: boolean;
  openInChat?: boolean;
  deliveredAt?: string;
  deliveredTabId?: string;
}

type QueuedAiRequest = AiRequest & { recordingId: string };

interface ListAiRequestsResult {
  requests: QueuedAiRequest[];
  titleCandidates: AutoTitleCandidate[];
  activeSessions?: ActiveAiRequestSession[];
}

type SessionRequestKind = ClipsAiRequestKind | "generate-workflow";

interface ActiveAiRequestSession extends BackgroundAgentSessionReceipt {
  recordingId: string;
  kind: SessionRequestKind;
  requestedAt: string;
  requestId?: string;
  runId?: string;
  updatedAt?: string;
}

const DISPATCHABLE_REQUESTS = new Set([
  "generate-metadata",
  "regenerate-title",
  "regenerate-summary",
  "regenerate-chapters",
  "remove-filler-words",
  "remove-silences",
  "generate-workflow",
]);

export function useAutoTitleBridge(): void {
  const { data, refetch } = useActionQuery<ListAiRequestsResult>(
    "list-ai-requests",
    {} as any,
    {
      refetchInterval: (query) =>
        query.state.data?.requests.length ||
        query.state.data?.activeSessions?.length
          ? 5_000
          : false,
    },
  );
  const refreshVersion = useChangeVersion(AI_REQUEST_REFRESH_SOURCE);
  const dispatched = useRef<Set<string>>(new Set());
  const monitoredSessions = useRef<Set<string>>(new Set());
  const inflight = useRef<boolean>(false);
  const mounted = useRef(false);
  const retryDelay = useRef(AI_REQUEST_RETRY_INITIAL_DELAY_MS);
  const retryNotBefore = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (refreshVersion) void refetch();
  }, [refreshVersion, refetch]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let concurrencyTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let retryScheduled = false;
    let completedWork = false;

    function scheduleRetryWakeup() {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(
        () => {
          retryTimer = null;
          if (cancelled) return;
          const remaining = retryNotBefore.current - Date.now();
          if (remaining > 0) {
            scheduleRetryWakeup();
            return;
          }
          retryScheduled = false;
          void refetch()
            .then((result) => {
              if (cancelled) return;
              if (result.data) void deliver(result.data);
              else retrySoon();
            })
            .catch(() => {
              if (!cancelled) retrySoon();
            });
        },
        Math.max(0, retryNotBefore.current - Date.now()),
      );
    }

    function retrySoon() {
      if (cancelled || retryScheduled) return;
      retryScheduled = true;
      recordRetryDelay();
      scheduleRetryWakeup();
    }

    function recordRetryDelay() {
      const delay = retryDelay.current;
      retryDelay.current = nextAiRequestRetryDelay(delay);
      retryNotBefore.current = Math.max(
        retryNotBefore.current,
        Date.now() + delay,
      );
    }

    function retryTitleFallback(key: string) {
      dispatched.current.delete(key);
      if (!cancelled) {
        retrySoon();
        return;
      }

      if (!retryScheduled) {
        retryScheduled = true;
        recordRetryDelay();
      }
      bumpAiRequestRefresh();
    }

    async function deliver(snapshot: ListAiRequestsResult) {
      if (cancelled) return;
      if (Date.now() < retryNotBefore.current) {
        scheduleRetryWakeup();
        return;
      }
      if (inflight.current) {
        if (concurrencyTimer) return;
        concurrencyTimer = setTimeout(() => {
          concurrencyTimer = null;
          void deliver(snapshot);
        }, 50);
        return;
      }
      inflight.current = true;
      try {
        const pending = new Set<string>();
        for (const request of snapshot.requests) {
          if (cancelled) return;
          if (!request.kind || !DISPATCHABLE_REQUESTS.has(request.kind)) {
            continue;
          }
          pending.add(request.recordingId);
          const dispatchKey = `${request.recordingId}:${request.kind}:${
            request.requestId ?? request.requestedAt ?? "0"
          }`;
          if (dispatched.current.has(dispatchKey)) continue;
          if (
            request.kind === "generate-metadata" ||
            request.kind === "regenerate-title"
          ) {
            dispatched.current.add(fallbackKey(request.recordingId));
          }

          if (
            request.kind === "generate-workflow" &&
            typeof request.requestedAt === "string"
          ) {
            const workflowRequest = {
              recordingId: request.recordingId,
              requestedAt: request.requestedAt,
              ...(request.requestId ? { requestId: request.requestId } : {}),
            };
            if (request.deliveredTabId) {
              dispatched.current.add(dispatchKey);
              completedWork = true;
              void consumeWorkflowRequest({
                ...workflowRequest,
                tabId: request.deliveredTabId,
              });
              continue;
            }

            const tabId = workflowTabId(
              request.recordingId,
              request.requestedAt,
              request.requestId,
            );
            try {
              const result = (await callAction(
                "reconcile-workflow-generation" as any,
                {
                  operation: "track",
                  ...workflowRequest,
                  tabId,
                } as any,
              )) as { tracked?: boolean; consumed?: boolean };
              if (result.consumed === true) {
                dispatched.current.add(dispatchKey);
                completedWork = true;
                bumpAiRequestRefresh();
                continue;
              }
              if (result.tracked !== true) {
                retrySoon();
                continue;
              }
            } catch {
              retrySoon();
              continue;
            }
            const result = await dispatchWorkflowRequest(
              request,
              workflowRequest,
              tabId,
            );
            if (!result.handled) {
              retrySoon();
              continue;
            }
            dispatched.current.add(dispatchKey);
            completedWork = true;
            if (result.accepted) {
              bumpAiRequestRefresh();
              void refetch();
            }
            continue;
          }
          if (
            typeof request.requestedAt !== "string" ||
            !request.requestedAt.trim()
          ) {
            console.warn("[clips] queued AI request is missing requestedAt", {
              recordingId: request.recordingId,
              kind: request.kind,
            });
            retrySoon();
            continue;
          }
          const result = await dispatchBackgroundAiRequest(request);
          if (!result.handled) {
            retrySoon();
            continue;
          }
          dispatched.current.add(dispatchKey);
          completedWork = true;
          if (result.accepted) {
            bumpAiRequestRefresh();
            void refetch();
          }
        }

        for (const candidate of snapshot.titleCandidates) {
          if (cancelled) return;
          if (pending.has(candidate.id)) continue;
          if (autoTitleFallbackDelay(candidate, dispatched.current) !== 0) {
            continue;
          }
          const key = fallbackKey(candidate.id);
          dispatched.current.add(key);
          callAction(
            "regenerate-title" as any,
            { recordingId: candidate.id } as any,
          )
            .then((result) => {
              const outcome = result as {
                queued?: boolean;
                updated?: boolean;
              } | null;
              if (outcome?.queued === true) {
                bumpAiRequestRefresh();
              } else if (outcome?.updated !== true) {
                retryTitleFallback(key);
              }
            })
            .catch(() => {
              retryTitleFallback(key);
            });
        }
      } finally {
        inflight.current = false;
        if (completedWork && !retryScheduled) {
          retryDelay.current = AI_REQUEST_RETRY_INITIAL_DELAY_MS;
          retryNotBefore.current = 0;
        }
      }
    }

    function scheduleNextFallback() {
      if (cancelled || !data) return;
      const delay = nextAutoTitleFallbackDelay(
        data.titleCandidates,
        dispatched.current,
      );
      if (delay === null) return;
      fallbackTimer = setTimeout(
        () => {
          fallbackTimer = null;
          void deliver(data).finally(scheduleNextFallback);
        },
        Math.max(delay, retryNotBefore.current - Date.now(), 50),
      );
    }

    void deliver(data).finally(scheduleNextFallback);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (concurrencyTimer) clearTimeout(concurrencyTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [data, refetch, refreshVersion]);

  useEffect(() => {
    for (const session of data?.activeSessions ?? []) {
      const operationKey = session.operationId;
      if (monitoredSessions.current.has(operationKey)) continue;
      monitoredSessions.current.add(operationKey);
      void monitorAiRequestSession(session, () => !mounted.current).finally(
        () => {
          monitoredSessions.current.delete(operationKey);
        },
      );
    }
  }, [data?.activeSessions]);
}

export function nextAiRequestRetryDelay(currentDelay: number): number {
  return Math.min(
    Math.max(currentDelay, AI_REQUEST_RETRY_INITIAL_DELAY_MS) * 2,
    AI_REQUEST_RETRY_MAX_DELAY_MS,
  );
}

function fallbackKey(recordingId: string): string {
  return `${recordingId}:fallback`;
}

/**
 * Milliseconds until the auto-title fallback may run for this candidate, or
 * `null` once it has been dispatched. Eligibility is decided by the server.
 */
function autoTitleFallbackDelay(
  candidate: AutoTitleCandidate,
  dispatched: ReadonlySet<string>,
  now = Date.now(),
): number | null {
  if (dispatched.has(fallbackKey(candidate.id))) return null;
  const createdAt = new Date(candidate.createdAt).getTime();
  return Number.isFinite(createdAt)
    ? Math.max(0, TWO_MINUTES_MS - (now - createdAt))
    : 0;
}

export function nextAutoTitleFallbackDelay(
  candidates: readonly AutoTitleCandidate[],
  dispatched: ReadonlySet<string>,
  now = Date.now(),
): number | null {
  let nextDelay: number | null = null;
  for (const candidate of candidates) {
    const delay = autoTitleFallbackDelay(candidate, dispatched, now);
    if (delay === null) continue;
    nextDelay = nextDelay === null ? delay : Math.min(nextDelay, delay);
  }
  return nextDelay;
}

function buildRequestContext(request: QueuedAiRequest) {
  return {
    recordingId: request.recordingId,
    currentTitle: request.currentTitle ?? "",
    currentDescription: request.currentDescription ?? "",
    transcript: request.transcriptText ?? "",
    agentsContext: request.agentsContext ?? "",
    transcriptStatus: request.transcriptStatus ?? "ready",
    transcriptSegments: parseJsonArray(request.segmentsJson),
    includeFullVideoInAi: request.includeFullVideoInAi === true,
    includeSummary: request.includeSummary === true,
    request,
  };
}

interface WorkflowRunRequest {
  recordingId: string;
  requestedAt: string;
  requestId?: string;
  tabId: string;
}

export async function retryWorkflowAction(
  request: WorkflowRunRequest & { operation: string },
  successKey: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < WORKFLOW_ACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = (await callAction(
        "reconcile-workflow-generation" as any,
        request as any,
      )) as Record<string, unknown>;
      if (result[successKey] === true) return true;
      if (typeof result.reason === "string" && result.reason !== "stale") {
        return false;
      }
    } catch {}

    if (attempt === WORKFLOW_ACTION_MAX_ATTEMPTS - 1) return false;
    await new Promise((resolve) =>
      setTimeout(resolve, WORKFLOW_ACTION_RETRY_DELAY_MS * 2 ** attempt),
    );
  }

  return false;
}

async function consumeWorkflowRequest(
  request: WorkflowRunRequest,
): Promise<boolean> {
  return retryWorkflowAction({ ...request, operation: "consume" }, "consumed");
}

async function persistAndConsumeWorkflowRequest(
  request: WorkflowRunRequest,
): Promise<void> {
  const delivered = await retryWorkflowAction(
    { ...request, operation: "mark-delivered" },
    "delivered",
  );
  if (delivered) await consumeWorkflowRequest(request);
}

function workflowTabId(
  recordingId: string,
  requestedAt: string,
  requestId?: string,
) {
  const identity = requestId
    ? `${encodeURIComponent(requestedAt)}:${encodeURIComponent(requestId)}`
    : encodeURIComponent(requestedAt);
  return `clips-workflow:${recordingId}:${identity}:run`;
}

type BackgroundAiRequestStatus =
  | "completed"
  | "failed"
  | "truncated"
  | "cancelled";

export function backgroundAiRequestStatus(
  snapshot: BackgroundAgentSessionSnapshot,
): BackgroundAiRequestStatus | null {
  if (!snapshot.runId) return null;
  switch (snapshot.status) {
    case "completed":
      return "completed";
    case "truncated":
      return "truncated";
    case "errored":
      return "failed";
    case "aborted":
      return "cancelled";
    default:
      return null;
  }
}

type RequestSession = Pick<
  ActiveAiRequestSession,
  "recordingId" | "requestedAt" | "operationId"
> &
  Partial<Pick<ActiveAiRequestSession, "threadId" | "turnId">> & {
    kind: ClipsAiRequestKind;
  };

type DispatchResult = { handled: boolean; accepted: boolean };

async function persistAiRequestStatus(
  session: RequestSession,
  status: "working" | BackgroundAiRequestStatus,
  snapshot?: BackgroundAgentSessionSnapshot,
): Promise<boolean> {
  try {
    await callAction(
      "update-ai-request-status" as any,
      {
        recordingId: session.recordingId,
        kind: session.kind,
        requestedAt: session.requestedAt,
        operationId: session.operationId,
        ...(session.threadId ? { threadId: session.threadId } : {}),
        ...(session.turnId ? { turnId: session.turnId } : {}),
        ...(snapshot?.runId ? { runId: snapshot.runId } : {}),
        status,
        ...(snapshot?.terminalReason
          ? { message: snapshot.terminalReason.slice(0, 500) }
          : {}),
      } as any,
    );
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      /already (completed|failed|truncated|cancelled)/i.test(error.message)
    ) {
      return true;
    }
    console.warn("[clips] failed to persist AI request session status", {
      recordingId: session.recordingId,
      kind: session.kind,
      requestedAt: session.requestedAt,
      status,
      error,
    });
    return false;
  }
}

async function consumeAiRequest(
  session: Pick<RequestSession, "recordingId" | "kind" | "requestedAt">,
): Promise<void> {
  try {
    await callAction(
      "consume-ai-request" as any,
      {
        recordingId: session.recordingId,
        kind: session.kind,
        requestedAt: session.requestedAt,
      } as any,
    );
  } catch (error) {
    console.warn("[clips] failed to consume queued AI request", {
      recordingId: session.recordingId,
      kind: session.kind,
      requestedAt: session.requestedAt,
      error,
    });
  }
}

type SessionStartOutcome =
  | { type: "accepted"; receipt: BackgroundAgentSessionReceipt }
  | { type: "running"; snapshot: BackgroundAgentSessionSnapshot }
  | {
      type: "finished";
      snapshot: BackgroundAgentSessionSnapshot;
      status: BackgroundAiRequestStatus;
    }
  | { type: "rejected" }
  | { type: "uncertain" };

async function startRequestSession(
  options: BackgroundAgentSessionStartOptions,
  openInChat: boolean,
): Promise<SessionStartOutcome> {
  let handle: ReturnType<typeof startBackgroundAgentSession> | undefined;
  let receipt: BackgroundAgentSessionReceipt;
  try {
    handle = startBackgroundAgentSession(options);
    receipt = await handle.accepted;
  } catch (error) {
    let snapshot: BackgroundAgentSessionSnapshot | undefined;
    try {
      snapshot = handle
        ? await getBackgroundAgentSessionStatus(handle)
        : undefined;
    } catch {
      // A failed status read cannot confirm that the run manager accepted it.
    }
    const terminalStatus = snapshot
      ? backgroundAiRequestStatus(snapshot)
      : null;
    if (snapshot?.runId && terminalStatus) {
      return { type: "finished", snapshot, status: terminalStatus };
    }
    if (
      snapshot &&
      (snapshot.status === "queued" || snapshot.status === "running")
    ) {
      return { type: "running", snapshot };
    }
    if (!handle || isConfirmedBackgroundSessionRejection(error)) {
      return { type: "rejected" };
    }
    // Acceptance is unconfirmed. Callers keep the durable request queued; a
    // retry reuses the same operation id, so it reattaches instead of starting
    // a second run.
    return { type: "uncertain" };
  }
  if (openInChat) handle.open();
  return { type: "accepted", receipt };
}

function requestModelOptions(request: QueuedAiRequest) {
  const selection =
    request.includeFullVideoInAi === true ? fullVideoAiModelSelection() : null;
  return selection ? { engine: selection.engine, model: selection.model } : {};
}

async function dispatchBackgroundAiRequest(
  request: QueuedAiRequest,
): Promise<DispatchResult> {
  if (typeof request.requestedAt !== "string" || !request.kind) {
    return { handled: false, accepted: false };
  }
  const kind = request.kind as ClipsAiRequestKind;
  const stableId = aiRequestTabId(
    request.recordingId,
    kind,
    request.requestedAt,
  );
  const session: RequestSession = {
    recordingId: request.recordingId,
    kind,
    requestedAt: request.requestedAt,
    operationId: stableId,
    threadId: stableId,
  };

  let instructions: string;
  if (kind === "remove-filler-words") {
    const transcript = parseFillerTranscriptSegments(request.segmentsJson);
    if (!transcript.ok) {
      console.warn(
        "[clips] filler-word request has unreadable transcript segments",
        {
          recordingId: request.recordingId,
          requestedAt: request.requestedAt,
          reason: transcript.reason,
        },
      );
      const saved = await persistAiRequestStatus(session, "failed");
      if (saved) await consumeAiRequest(session);
      return { handled: saved, accepted: false };
    }
    instructions = JSON.stringify({
      recordingId: request.recordingId,
      transcriptSegments: transcript.segments,
    });
  } else {
    instructions = JSON.stringify(buildRequestContext(request));
  }

  try {
    await callAction(
      "update-ai-request-status" as any,
      {
        recordingId: session.recordingId,
        kind,
        requestedAt: session.requestedAt,
        operationId: session.operationId,
        status: "working",
      } as any,
    );
  } catch (error) {
    console.warn("[clips] queued AI request could not be claimed", {
      recordingId: request.recordingId,
      kind,
      requestedAt: request.requestedAt,
      error,
    });
    return { handled: false, accepted: false };
  }

  const outcome = await startRequestSession(
    {
      message:
        request.message ??
        `Handle queued ${kind} work for recording ${request.recordingId}.`,
      operationId: session.operationId,
      threadId: session.threadId,
      instructions,
      usageLabel: `clips:${kind}`,
      ...requestModelOptions(request),
    },
    request.openInChat === true,
  );

  switch (outcome.type) {
    case "finished": {
      const saved = await persistAiRequestStatus(
        {
          ...session,
          threadId: outcome.snapshot.threadId,
          turnId: outcome.snapshot.turnId,
        },
        outcome.status,
        outcome.snapshot,
      );
      if (saved) await consumeAiRequest(session);
      return { handled: saved, accepted: false };
    }
    case "running": {
      const saved = await persistAiRequestStatus(
        {
          ...session,
          threadId: outcome.snapshot.threadId,
          turnId: outcome.snapshot.turnId,
        },
        "working",
        outcome.snapshot,
      );
      if (saved) await consumeAiRequest(session);
      return { handled: saved, accepted: saved };
    }
    case "rejected": {
      const saved = await persistAiRequestStatus(session, "failed");
      if (saved) await consumeAiRequest(session);
      return { handled: saved, accepted: false };
    }
    case "uncertain":
      return { handled: false, accepted: false };
    case "accepted": {
      const saved = await persistAiRequestStatus(
        {
          ...session,
          threadId: outcome.receipt.threadId,
          turnId: outcome.receipt.turnId,
        },
        "working",
      );
      if (!saved) return { handled: false, accepted: false };
      await consumeAiRequest(session);
      return { handled: true, accepted: true };
    }
  }
}

async function dispatchWorkflowRequest(
  request: QueuedAiRequest,
  workflowRequest: Omit<WorkflowRunRequest, "tabId">,
  tabId: string,
): Promise<DispatchResult> {
  const outcome = await startRequestSession(
    {
      message:
        request.message ??
        `Generate the requested workflow for recording ${request.recordingId}.`,
      operationId: tabId,
      threadId: tabId,
      instructions: JSON.stringify(buildRequestContext(request)),
      usageLabel: "clips:generate-workflow",
      ...requestModelOptions(request),
    },
    request.openInChat === true,
  );

  if (outcome.type === "rejected") {
    await retryWorkflowAction(
      { operation: "release", ...workflowRequest, tabId },
      "released",
    );
    return { handled: false, accepted: false };
  }
  if (outcome.type === "uncertain") {
    return { handled: false, accepted: false };
  }
  void persistAndConsumeWorkflowRequest({ ...workflowRequest, tabId });
  return { handled: true, accepted: true };
}

function isConfirmedBackgroundSessionRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: unknown }).status;
  return (
    /^Background agent session was rejected \(HTTP \d+\)/.test(error.message) &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    ![408, 409, 425, 429].includes(status)
  );
}

async function settleWorkflowSession(
  session: ActiveAiRequestSession,
): Promise<boolean> {
  try {
    const result = (await callAction(
      "reconcile-workflow-generation" as any,
      {
        operation: "stop",
        recordingId: session.recordingId,
        requestedAt: session.requestedAt,
        ...(session.requestId ? { requestId: session.requestId } : {}),
        tabId: session.operationId,
      } as any,
    )) as { reconciled?: boolean; reason?: string };
    return (
      result.reconciled === true ||
      (typeof result.reason === "string" && result.reason !== "stale")
    );
  } catch (error) {
    console.warn("[clips] failed to reconcile finished workflow session", {
      recordingId: session.recordingId,
      requestedAt: session.requestedAt,
      tabId: session.operationId,
      error,
    });
    return false;
  }
}

async function persistSessionOutcome(
  session: ActiveAiRequestSession,
  status: "working" | BackgroundAiRequestStatus,
  snapshot: BackgroundAgentSessionSnapshot,
): Promise<boolean> {
  if (session.kind !== "generate-workflow") {
    return persistAiRequestStatus(
      { ...session, kind: session.kind },
      status,
      snapshot,
    );
  }
  return status === "working" ? true : settleWorkflowSession(session);
}

async function monitorAiRequestSession(
  session: ActiveAiRequestSession,
  shouldStop: () => boolean,
): Promise<void> {
  let retryDelay = BACKGROUND_SESSION_POLL_INTERVAL_MS;
  let knownRunId = session.runId;
  let missingSince: number | null = null;

  while (!shouldStop()) {
    let snapshot: BackgroundAgentSessionSnapshot | undefined;
    try {
      snapshot = await getBackgroundAgentSessionStatus(session);
    } catch {
      if (shouldStop()) return;
      missingSince = null;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 10_000);
      continue;
    }
    if (shouldStop()) return;

    if (snapshot.status === "unavailable") {
      missingSince ??= Date.now();
      if (
        Date.now() - missingSince >=
        BACKGROUND_SESSION_MISSING_CONFIRMATION_MS
      ) {
        if (await persistSessionOutcome(session, "failed", snapshot)) {
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 10_000);
      continue;
    }
    missingSince = null;

    const terminalStatus = backgroundAiRequestStatus(snapshot);
    if (terminalStatus) {
      if (await persistSessionOutcome(session, terminalStatus, snapshot)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 10_000);
      continue;
    }

    if (!snapshot.runId) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 10_000);
      continue;
    }

    retryDelay = BACKGROUND_SESSION_POLL_INTERVAL_MS;
    if (knownRunId !== snapshot.runId) {
      knownRunId = snapshot.runId;
      if (!(await persistSessionOutcome(session, "working", snapshot))) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 10_000);
        continue;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, BACKGROUND_SESSION_POLL_INTERVAL_MS),
    );
  }
}

function parseJsonArray(raw: string | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseFillerTranscriptSegments(raw: string | undefined):
  | { ok: true; segments: unknown[] }
  | {
      ok: false;
      reason: "missing" | "invalid-json" | "not-an-array" | "invalid-segment";
    } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, reason: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: "not-an-array" };
  }
  const nonBlankSegments: unknown[] = [];
  for (const segment of parsed) {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      return { ok: false, reason: "invalid-segment" };
    }
    const candidate = segment as {
      startMs?: unknown;
      endMs?: unknown;
      text?: unknown;
    };
    if (
      typeof candidate.startMs !== "number" ||
      !Number.isFinite(candidate.startMs) ||
      typeof candidate.endMs !== "number" ||
      !Number.isFinite(candidate.endMs) ||
      candidate.endMs <= candidate.startMs ||
      typeof candidate.text !== "string"
    ) {
      return { ok: false, reason: "invalid-segment" };
    }
    if (candidate.text.trim()) nonBlankSegments.push(segment);
  }
  if (parsed.length > 0 && nonBlankSegments.length === 0) {
    return { ok: false, reason: "invalid-segment" };
  }
  const segments = parseTranscriptSegments(JSON.stringify(nonBlankSegments));
  if (segments.length !== nonBlankSegments.length) {
    return { ok: false, reason: "invalid-segment" };
  }
  return { ok: true, segments };
}
