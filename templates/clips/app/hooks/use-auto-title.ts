import {
  generateTabId,
  sendToAgentChat,
  sendToAgentChatAndConfirm,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { callAction, useChangeVersions } from "@agent-native/core/client/hooks";
import { fullVideoAiModelSelection } from "@shared/clips-ai-prefs";
import { useEffect, useRef } from "react";

import { useRecordings, type RecordingSummary } from "./use-library";

const DEFAULT_TITLE = "Untitled recording";
const TWO_MINUTES_MS = 2 * 60 * 1000;
export const WORKFLOW_ACTION_MAX_ATTEMPTS = 5;
const WORKFLOW_ACTION_RETRY_DELAY_MS = 1000;

/** True when `title` is blank or equal to the server-seeded default. */
export function isDefaultTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  if (!trimmed) return true;
  return trimmed === DEFAULT_TITLE;
}

export function isAutoTitleReplaceable(
  title: string | null | undefined,
  titleSource: string | null | undefined,
): boolean {
  return (
    isDefaultTitle(title) ||
    titleSource === "default" ||
    titleSource === "context"
  );
}

interface AiRequest {
  kind?: string;
  recordingId?: string;
  requestedAt?: string;
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

const DISPATCHABLE_REQUESTS = new Set([
  "generate-metadata",
  "regenerate-title",
  "regenerate-summary",
  "regenerate-chapters",
  "remove-filler-words",
  "remove-silences",
  "generate-workflow",
]);

async function listRequests(): Promise<Map<string, AiRequest>> {
  try {
    const result = (await callAction("list-ai-requests", {} as any, {
      method: "GET",
    })) as { requests?: AiRequest[] } | null | undefined;
    return new Map(
      (result?.requests ?? [])
        .filter(
          (r): r is AiRequest & { recordingId: string } => !!r?.recordingId,
        )
        .map((r) => [r.recordingId, r]),
    );
  } catch {
    // Swallow — the next tick retries.
    return new Map();
  }
}

async function clearRequest(recordingId: string): Promise<void> {
  const url = agentNativePath(
    `/_agent-native/application-state/${encodeURIComponent(
      `clips-ai-request-${recordingId}`,
    )}`,
  );
  await fetch(url, { method: "DELETE" }).catch(() => {});
}

/**
 * Mount this once in the app shell. It watches the exact application-state
 * keys used for queued Clips AI work and fires `sendToAgentChat` for every
 * pending request queued by a clips action.
 * Idempotent — a given (recordingId, kind, requestedAt) is only dispatched
 * once per tab session.
 */
export function useAutoTitleBridge(): void {
  // Use the "all" view so we catch recordings regardless of where the user
  // is currently browsing (library root vs. a folder vs. a space).
  const { data } = useRecordings({ view: "all", limit: 200 });
  const recordings: RecordingSummary[] = data?.recordings ?? [];
  const dispatched = useRef<Set<string>>(new Set());
  const inflight = useRef<boolean>(false);

  useEffect(() => {
    const handleChatRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.isRunning !== false ||
        (detail.reason !== "stopped" && detail.reason !== "failed") ||
        typeof detail.tabId !== "string"
      )
        return;

      const recordingId = recordingIdFromTab(detail.tabId);
      const requestedAt = requestedAtFromTab(detail.tabId);
      if (!recordingId || !requestedAt) return;

      void retryWorkflowAction(
        {
          operation: "stop",
          recordingId,
          requestedAt,
          tabId: detail.tabId,
        },
        "reconciled",
      );
    };

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  const readyRecordings = recordings.filter((r) => r.status === "ready");
  const readyRecordingsKey = readyRecordings
    .map(
      (r) =>
        `${r.id}:${r.titleSource ?? ""}:${r.title}:${r.updatedAt}:${r.transcriptStatus ?? ""}:${r.transcriptHasText ? "1" : "0"}`,
    )
    .join("|");
  const aiRequestVersion = useChangeVersions(
    readyRecordings.map(
      (recording) => `app-state:clips-ai-request-${recording.id}`,
    ),
  );

  useEffect(() => {
    if (readyRecordings.length === 0) return;
    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      if (inflight.current) {
        // A new request-state version can arrive while the previous list read
        // is in flight. Recheck after it settles so that event is not the last
        // chance to dispatch the queued work.
        fallbackTimer = setTimeout(() => void tick(), 50);
        return;
      }
      inflight.current = true;
      try {
        const requestsById = await listRequests();
        if (cancelled) return;

        for (const rec of readyRecordings) {
          if (cancelled) return;

          const request = requestsById.get(rec.id) ?? null;

          if (request?.kind && DISPATCHABLE_REQUESTS.has(request.kind)) {
            // Server queued a delegation — use the full context it provided.
            // Key includes requestedAt so each distinct server request fires
            // exactly once, independent of any prior fallback dispatch.
            const dispatchKey = `${rec.id}:${request.kind}:${
              request.requestedAt ?? "0"
            }`;
            if (dispatched.current.has(dispatchKey)) continue;
            if (
              request.kind === "generate-metadata" ||
              request.kind === "regenerate-title"
            ) {
              // The temporary title remains replaceable while the background
              // agent runs. Suppress the old-recording fallback in this tab so
              // clearing the request does not immediately launch a duplicate.
              dispatched.current.add(`${rec.id}:fallback`);
            }

            if (
              request.kind === "generate-workflow" &&
              typeof request.requestedAt === "string"
            ) {
              if (request.deliveredTabId) {
                dispatched.current.add(dispatchKey);
                void consumeWorkflowRequest({
                  recordingId: rec.id,
                  requestedAt: request.requestedAt,
                  tabId: request.deliveredTabId,
                });
                continue;
              }

              const tabId = workflowTabId(rec.id, request.requestedAt);
              try {
                const result = (await callAction(
                  "reconcile-workflow-generation" as any,
                  {
                    operation: "track",
                    recordingId: rec.id,
                    requestedAt: request.requestedAt,
                    tabId,
                  } as any,
                )) as { tracked?: boolean };
                if (result.tracked !== true) {
                  fallbackTimer = setTimeout(() => void tick(), 1000);
                  continue;
                }
              } catch {
                fallbackTimer = setTimeout(() => void tick(), 1000);
                continue;
              }
              const delivery = await sendToAgentChatAndConfirm({
                ...buildAiRequestChatOptions(rec, request),
                tabId,
                chatTarget: "local",
              });
              if (!delivery.delivered) {
                await retryWorkflowAction(
                  {
                    operation: "release",
                    recordingId: rec.id,
                    requestedAt: request.requestedAt,
                    tabId,
                  },
                  "released",
                );
                fallbackTimer = setTimeout(() => void tick(), 1000);
                continue;
              }
              dispatched.current.add(dispatchKey);
              void persistAndConsumeWorkflowRequest({
                recordingId: rec.id,
                requestedAt: request.requestedAt,
                tabId,
              });
              continue;
            }
            dispatchAiRequest(rec, request);
            dispatched.current.add(dispatchKey);
            void clearRequest(rec.id);
          } else if (isAutoTitleReplaceable(rec.title, rec.titleSource)) {
            // No server-queued delegation. Only dispatch the fallback for
            // recordings that are old enough (>2 min) that the server has had
            // ample time to write its own clips-ai-request entry. For freshly-
            // finalized clips the server request may still be en route; if we
            // dispatch now we'd block that richer transcript-backed delegation.
            if (
              rec.transcriptStatus !== "ready" ||
              rec.transcriptHasText !== true
            ) {
              continue;
            }

            if (Date.now() - new Date(rec.createdAt).getTime() < TWO_MINUTES_MS)
              continue;

            // Use a dedicated key so a later server-queued request (e.g. from
            // a long transcription that finishes after the 2-min window) is
            // NOT blocked by this fallback having already run.
            const fallbackKey = `${rec.id}:fallback`;
            if (dispatched.current.has(fallbackKey)) continue;
            dispatched.current.add(fallbackKey);

            callAction(
              "regenerate-title" as any,
              { recordingId: rec.id } as any,
            ).catch(() => {});
          }
        }
      } finally {
        inflight.current = false;
      }
    }

    function scheduleNextFallback() {
      if (cancelled) return;
      const delay = nextAutoTitleFallbackDelay(
        readyRecordings,
        dispatched.current,
      );
      if (delay === null) return;
      // Keep the timeout non-zero so a failed request cannot spin a tight loop.
      fallbackTimer = setTimeout(
        () => {
          fallbackTimer = null;
          void tick().finally(scheduleNextFallback);
        },
        Math.max(delay, 50),
      );
    }

    // One initial read catches requests queued before this component mounted.
    // Later reads are driven by the exact clips-ai-request application-state
    // counters above. The only timer left is a one-shot wake-up when an old
    // transcript-backed recording becomes eligible for the legacy fallback.
    void tick().finally(scheduleNextFallback);
    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
    // readyRecordingsKey is the stable snapshot consumed by tick; depending on
    // the array itself would restart the effect on every query result object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRequestVersion, readyRecordingsKey]);
}

export function nextAutoTitleFallbackDelay(
  recordings: readonly RecordingSummary[],
  dispatched: ReadonlySet<string>,
  now = Date.now(),
): number | null {
  let nextDelay: number | null = null;

  for (const recording of recordings) {
    if (recording.status !== "ready") continue;
    if (!isAutoTitleReplaceable(recording.title, recording.titleSource)) {
      continue;
    }
    if (
      recording.transcriptStatus !== "ready" ||
      recording.transcriptHasText !== true ||
      dispatched.has(`${recording.id}:fallback`)
    ) {
      continue;
    }

    const createdAt = new Date(recording.createdAt).getTime();
    const delay = Number.isFinite(createdAt)
      ? Math.max(0, TWO_MINUTES_MS - (now - createdAt))
      : 0;
    nextDelay = nextDelay === null ? delay : Math.min(nextDelay, delay);
  }

  return nextDelay;
}

function buildRequestContext(rec: RecordingSummary, request: AiRequest) {
  return {
    recordingId: rec.id,
    currentTitle: request.currentTitle ?? rec.title,
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
  rec: RecordingSummary,
  request: AiRequest,
): AgentChatMessage {
  const includeFullVideo = request.includeFullVideoInAi === true;
  const gemini = includeFullVideo ? fullVideoAiModelSelection() : null;
  const openInChat = request.openInChat === true;
  return {
    message:
      request.message ??
      `Handle queued ${request.kind} work for recording ${rec.id}.`,
    context: JSON.stringify(buildRequestContext(rec, request)),
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

function workflowTabId(recordingId: string, requestedAt: string) {
  return `clips-workflow:${recordingId}:${encodeURIComponent(requestedAt)}:${generateTabId()}`;
}

function recordingIdFromTab(tabId: string) {
  const match = /^clips-workflow:([^:]+):/.exec(tabId);
  return match?.[1];
}

function requestedAtFromTab(tabId: string) {
  const match = /^clips-workflow:[^:]+:([^:]+):/.exec(tabId);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function dispatchAiRequest(
  rec: RecordingSummary,
  request: AiRequest,
  tabId?: string,
) {
  return sendToAgentChat({
    ...buildAiRequestChatOptions(rec, request),
    ...(tabId ? { tabId } : {}),
  });
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
