import {
  generateTabId,
  getBackgroundAgentSessionStatus,
  sendToAgentChatAndConfirm,
  startBackgroundAgentSession,
  type AgentChatMessage,
  type BackgroundAgentSessionReceipt,
  type BackgroundAgentSessionSnapshot,
} from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  bumpChangeVersion,
  callAction,
  getChangeVersion,
  useActionQuery,
  useChangeVersion,
} from "@agent-native/core/client/hooks";
import {
  aiRequestTabId,
  parseAiRequestTabId,
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
const AI_REQUEST_DELIVERY_TIMEOUT_MS = 10_000;
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

interface ActiveAiRequestSession extends BackgroundAgentSessionReceipt {
  recordingId: string;
  kind: "remove-filler-words";
  requestedAt: string;
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

async function clearRequest(recordingId: string): Promise<void> {
  const url = agentNativePath(
    `/_agent-native/application-state/${encodeURIComponent(
      `clips-ai-request-${recordingId}`,
    )}`,
  );
  await fetch(url, { method: "DELETE" }).catch(() => {});
  bumpAiRequestRefresh();
}

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
    const handleChatRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning !== false || typeof detail.tabId !== "string")
        return;

      if (detail.reason !== "stopped" && detail.reason !== "failed") return;

      const aiRequest = parseAiRequestTabId(detail.tabId);
      if (aiRequest) {
        const status = detail.reason === "stopped" ? "cancelled" : "failed";
        void callAction(
          "update-ai-request-status" as any,
          { ...aiRequest, status } as any,
        ).catch((error) => {
          console.error(
            `[clips] failed to persist ${detail.reason} AI request status`,
            { ...aiRequest, error },
          );
        });
        return;
      }

      const recordingId = recordingIdFromTab(detail.tabId);
      const requestedAt = requestedAtFromTab(detail.tabId);
      const requestId = requestIdFromTab(detail.tabId);
      if (!recordingId || !requestedAt) return;

      void retryWorkflowAction(
        {
          operation: "stop",
          recordingId,
          requestedAt,
          ...(requestId ? { requestId } : {}),
          tabId: detail.tabId,
        },
        "reconciled",
      );
    };

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
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
              )) as { tracked?: boolean };
              if (result.tracked !== true) {
                retrySoon();
                continue;
              }
            } catch {
              retrySoon();
              continue;
            }
            const delivery = await sendToAgentChatAndConfirm({
              ...buildAiRequestChatOptions(request),
              tabId,
              chatTarget: "local",
            });
            if (!delivery.delivered) {
              await retryWorkflowAction(
                {
                  operation: "release",
                  ...workflowRequest,
                  tabId,
                },
                "released",
              );
              retrySoon();
              continue;
            }
            dispatched.current.add(dispatchKey);
            completedWork = true;
            void persistAndConsumeWorkflowRequest({
              ...workflowRequest,
              tabId,
            });
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
          if (request.kind === "remove-filler-words") {
            const result = await dispatchFillerWordsRequest(request);
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
          const delivery = await dispatchAiRequest(
            request,
            aiRequestTabId(
              request.recordingId,
              request.kind as ClipsAiRequestKind,
              request.requestedAt,
            ),
          );
          if (!delivery.delivered) {
            dispatched.current.delete(dispatchKey);
            retrySoon();
            continue;
          }
          dispatched.current.add(dispatchKey);
          completedWork = true;
          void clearRequest(request.recordingId);
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
      void monitorFillerWordsSession(session, () => !mounted.current).finally(
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

export function buildAiRequestChatOptions(
  request: QueuedAiRequest,
): AgentChatMessage {
  const includeFullVideo = request.includeFullVideoInAi === true;
  const gemini = includeFullVideo ? fullVideoAiModelSelection() : null;
  const openInChat = request.openInChat === true;
  return {
    message:
      request.message ??
      `Handle queued ${request.kind} work for recording ${request.recordingId}.`,
    context: JSON.stringify(buildRequestContext(request)),
    submit: true,
    openSidebar: openInChat ? true : false,
    newTab: true,
    background: !openInChat,
    ...(gemini
      ? {
          engine: gemini.engine,
          model: gemini.model,
        }
      : {}),
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
  return `clips-workflow:${recordingId}:${identity}:${generateTabId()}`;
}

function recordingIdFromTab(tabId: string) {
  const match = /^clips-workflow:([^:]+):/.exec(tabId);
  return match?.[1];
}

function requestedAtFromTab(tabId: string) {
  const match = /^clips-workflow:[^:]+:([^:]+):/.exec(tabId);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function requestIdFromTab(tabId: string) {
  const match = /^clips-workflow:[^:]+:[^:]+:([^:]+):[^:]+$/.exec(tabId);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function dispatchAiRequest(request: QueuedAiRequest, tabId: string) {
  return sendToAgentChatAndConfirm(
    {
      ...buildAiRequestChatOptions(request),
      chatTarget: "local",
      tabId,
    },
    { timeoutMs: AI_REQUEST_DELIVERY_TIMEOUT_MS },
  );
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

async function persistFillerWordsStatus(
  session: Pick<
    ActiveAiRequestSession,
    "recordingId" | "requestedAt" | "operationId"
  > &
    Partial<Pick<ActiveAiRequestSession, "threadId" | "turnId">>,
  status: "working" | BackgroundAiRequestStatus,
  snapshot?: BackgroundAgentSessionSnapshot,
): Promise<boolean> {
  try {
    await callAction(
      "update-ai-request-status" as any,
      {
        recordingId: session.recordingId,
        kind: "remove-filler-words",
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
    console.warn("[clips] failed to persist filler-word session status", {
      recordingId: session.recordingId,
      requestedAt: session.requestedAt,
      status,
      error,
    });
    return false;
  }
}

async function consumeFillerWordsRequest(
  session: Pick<ActiveAiRequestSession, "recordingId" | "requestedAt">,
): Promise<void> {
  try {
    await callAction(
      "consume-ai-request" as any,
      {
        recordingId: session.recordingId,
        kind: "remove-filler-words",
        requestedAt: session.requestedAt,
      } as any,
    );
  } catch (error) {
    console.warn("[clips] failed to consume filler-word request", {
      recordingId: session.recordingId,
      requestedAt: session.requestedAt,
      error,
    });
  }
}

async function dispatchFillerWordsRequest(
  request: QueuedAiRequest,
): Promise<{ handled: boolean; accepted: boolean }> {
  if (typeof request.requestedAt !== "string") {
    return { handled: false, accepted: false };
  }
  const stableId = aiRequestTabId(
    request.recordingId,
    "remove-filler-words",
    request.requestedAt,
  );
  const session = {
    recordingId: request.recordingId,
    kind: "remove-filler-words",
    requestedAt: request.requestedAt,
    operationId: stableId,
    threadId: stableId,
  };
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
    const saved = await persistFillerWordsStatus(session, "failed");
    if (saved) await consumeFillerWordsRequest(session);
    return { handled: saved, accepted: false };
  }

  try {
    await callAction(
      "update-ai-request-status" as any,
      {
        recordingId: session.recordingId,
        kind: session.kind,
        requestedAt: session.requestedAt,
        operationId: session.operationId,
        status: "working",
      } as any,
    );
  } catch (error) {
    console.warn("[clips] filler-word request could not be claimed", {
      recordingId: request.recordingId,
      requestedAt: request.requestedAt,
      error,
    });
    return { handled: false, accepted: false };
  }

  let handle: ReturnType<typeof startBackgroundAgentSession> | undefined;
  let receipt: BackgroundAgentSessionReceipt;
  try {
    handle = startBackgroundAgentSession({
      message:
        request.message ??
        `Identify and trim unambiguous filler words in recording ${request.recordingId}.`,
      operationId: session.operationId,
      threadId: session.threadId,
      instructions: JSON.stringify({
        recordingId: request.recordingId,
        transcriptSegments: transcript.segments,
      }),
      usageLabel: "clips:remove-filler-words",
    });
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
      const saved = await persistFillerWordsStatus(
        { ...session, threadId: snapshot.threadId, turnId: snapshot.turnId },
        terminalStatus,
        snapshot,
      );
      if (saved) await consumeFillerWordsRequest(session);
      return { handled: saved, accepted: false };
    }
    if (
      snapshot &&
      (snapshot.status === "queued" || snapshot.status === "running")
    ) {
      const saved = await persistFillerWordsStatus(
        { ...session, threadId: snapshot.threadId, turnId: snapshot.turnId },
        "working",
        snapshot,
      );
      if (saved) await consumeFillerWordsRequest(session);
      return { handled: saved, accepted: saved };
    }
    if (!handle || isConfirmedBackgroundSessionRejection(error)) {
      const saved = await persistFillerWordsStatus(session, "failed");
      if (saved) await consumeFillerWordsRequest(session);
      return { handled: saved, accepted: false };
    }

    // Keep the durable request queued when acceptance cannot be confirmed.
    // A later dispatch uses the same operation id, so it reattaches instead of
    // creating a second edit run.
    return { handled: false, accepted: false };
  }

  const saved = await persistFillerWordsStatus(
    { ...session, threadId: receipt.threadId, turnId: receipt.turnId },
    "working",
  );
  if (!saved) return { handled: false, accepted: false };
  await consumeFillerWordsRequest(session);
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

async function monitorFillerWordsSession(
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
        if (await persistFillerWordsStatus(session, "failed", snapshot)) {
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
      if (await persistFillerWordsStatus(session, terminalStatus, snapshot)) {
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
      if (!(await persistFillerWordsStatus(session, "working", snapshot))) {
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
