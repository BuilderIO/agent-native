/**
 * Clips AI request bridge
 *
 * Watches the `clips-ai-request-:id` application_state queue. The bridge sends
 * queued recording work to the agent chat exactly once per
 * (recordingId, kind, requestedAt).
 *
 * Once handled we DELETE the request entry so the next page load / tab switch
 * doesn't re-fire. The polling layer flips UI back to ready when the requested
 * action lands its writes.
 */

import { useEffect, useRef } from "react";
import { agentNativePath, sendToAgentChat } from "@agent-native/core/client";
import { useRecordings, type RecordingSummary } from "./use-library";

const DEFAULT_TITLE = "Untitled recording";
const POLL_INTERVAL_MS = 3000;

/** True when `title` is blank or equal to the server-seeded default. */
export function isDefaultTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  if (!trimmed) return true;
  return trimmed === DEFAULT_TITLE;
}

interface AiRequest {
  kind?: string;
  recordingId?: string;
  requestedAt?: string;
  currentTitle?: string;
  transcriptStatus?: string;
  transcriptText?: string;
  segmentsJson?: string;
  thresholdMs?: number;
  message?: string;
}

const DISPATCHABLE_REQUESTS = new Set([
  "regenerate-title",
  "regenerate-summary",
  "regenerate-chapters",
  "remove-filler-words",
  "remove-silences",
  "generate-workflow",
]);

async function readRequest(recordingId: string): Promise<AiRequest | null> {
  const url = agentNativePath(
    `/_agent-native/application-state/${encodeURIComponent(
      `clips-ai-request-${recordingId}`,
    )}`,
  );
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const payload = await res.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;
    // The application-state endpoint wraps stored values under `.value`.
    const value = (payload as any).value ?? payload;
    return value as AiRequest;
  } catch {
    return null;
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
 * Mount this once in the app shell. It polls the recording list and fires
 * `sendToAgentChat` for every pending request queued by a clips action.
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

  const readyRecordings = recordings.filter((r) => r.status === "ready");

  useEffect(() => {
    if (readyRecordings.length === 0) return;
    let cancelled = false;

    async function tick() {
      if (cancelled || inflight.current) return;
      inflight.current = true;
      try {
        for (const rec of readyRecordings) {
          if (cancelled) return;

          const request = await readRequest(rec.id);

          if (
            request?.kind &&
            DISPATCHABLE_REQUESTS.has(request.kind) &&
            request.recordingId === rec.id
          ) {
            // Server queued a delegation — use the full context it provided.
            // Key includes requestedAt so each distinct server request fires
            // exactly once, independent of any prior fallback dispatch.
            const dispatchKey = `${rec.id}:${request.kind}:${
              request.requestedAt ?? "0"
            }`;
            if (dispatched.current.has(dispatchKey)) continue;
            dispatched.current.add(dispatchKey);

            sendToAgentChat({
              message:
                request.message ??
                `Handle queued ${request.kind} work for recording ${rec.id}.`,
              context: JSON.stringify(buildRequestContext(rec, request)),
              submit: true,
              openSidebar: false,
            });

            void clearRequest(rec.id);
          } else if (isDefaultTitle(rec.title)) {
            // No server-queued delegation. Only dispatch the fallback for
            // recordings that are old enough (>2 min) that the server has had
            // ample time to write its own clips-ai-request entry. For freshly-
            // finalized clips the server request may still be en route; if we
            // dispatch now we'd block that richer transcript-backed delegation.
            const ageMs = Date.now() - new Date(rec.createdAt).getTime();
            const TWO_MINUTES_MS = 2 * 60 * 1000;
            if (ageMs < TWO_MINUTES_MS) continue;

            // Use a dedicated key so a later server-queued request (e.g. from
            // a long transcription that finishes after the 2-min window) is
            // NOT blocked by this fallback having already run.
            const fallbackKey = `${rec.id}:fallback`;
            if (dispatched.current.has(fallbackKey)) continue;
            dispatched.current.add(fallbackKey);

            fetch(agentNativePath("/_agent-native/actions/regenerate-title"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ recordingId: rec.id }),
            }).catch(() => {});
          }
        }
      } finally {
        inflight.current = false;
      }
    }

    tick();
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyRecordings.map((r) => r.id).join(",")]);
}

function buildRequestContext(rec: RecordingSummary, request: AiRequest) {
  return {
    recordingId: rec.id,
    currentTitle: request.currentTitle ?? rec.title,
    transcript: request.transcriptText ?? "",
    transcriptStatus: request.transcriptStatus ?? "ready",
    transcriptSegments: parseJsonArray(request.segmentsJson),
    request,
  };
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
