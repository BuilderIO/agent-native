import {
  generateTabId,
  sendToAgentChatAndConfirm,
  type AgentChatMessage,
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
import { useEffect, useRef } from "react";

const TWO_MINUTES_MS = 2 * 60 * 1000;
export const WORKFLOW_ACTION_MAX_ATTEMPTS = 5;
const WORKFLOW_ACTION_RETRY_DELAY_MS = 1000;
// `queueAiRequest` publishes `refresh-signal` after every queue, whoever the
// writer is. Sync drops this tab's own events, so local queues bump it too.
const AI_REQUEST_REFRESH_SOURCE = "app-state:refresh-signal";
const AI_REQUEST_DELIVERY_TIMEOUT_MS = 10_000;

export function notifyAiRequestQueued(recordingId: string): void {
  if (!recordingId) return;
  bumpChangeVersion(
    AI_REQUEST_REFRESH_SOURCE,
    Math.max(Date.now(), getChangeVersion(AI_REQUEST_REFRESH_SOURCE) + 1),
  );
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
}

export function useAutoTitleBridge(): void {
  const { data, refetch } = useActionQuery<ListAiRequestsResult>(
    "list-ai-requests",
    {} as any,
  );
  const refreshVersion = useChangeVersion(AI_REQUEST_REFRESH_SOURCE);
  const dispatched = useRef<Set<string>>(new Set());
  const inflight = useRef<boolean>(false);

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
    let timer: ReturnType<typeof setTimeout> | null = null;

    function retrySoon() {
      timer = setTimeout(() => {
        void refetch().then((result) => {
          if (!cancelled && result.data) void deliver(result.data);
        });
      }, 1000);
    }

    async function deliver(snapshot: ListAiRequestsResult) {
      if (cancelled) return;
      if (inflight.current) {
        timer = setTimeout(() => void deliver(snapshot), 50);
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
          void clearRequest(request.recordingId);
        }

        for (const candidate of snapshot.titleCandidates) {
          if (cancelled) return;
          if (pending.has(candidate.id)) continue;
          if (autoTitleFallbackDelay(candidate, dispatched.current) !== 0) {
            continue;
          }
          dispatched.current.add(fallbackKey(candidate.id));
          callAction(
            "regenerate-title" as any,
            { recordingId: candidate.id } as any,
          ).catch(() => {});
        }
      } finally {
        inflight.current = false;
      }
    }

    function scheduleNextFallback() {
      if (cancelled || !data) return;
      const delay = nextAutoTitleFallbackDelay(
        data.titleCandidates,
        dispatched.current,
      );
      if (delay === null) return;
      timer = setTimeout(
        () => {
          timer = null;
          void deliver(data).finally(scheduleNextFallback);
        },
        Math.max(delay, 50),
      );
    }

    void deliver(data).finally(scheduleNextFallback);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [data, refetch]);
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

function parseJsonArray(raw: string | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
