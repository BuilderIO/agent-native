/**
 * Auto-title bridge
 *
 * Watches the `clips-ai-request-:id` application_state queue that server-side
 * actions (notably `request-transcript` after a transcript lands ready) write
 * when a clip still has the default title. For each pending request with
 * kind="regenerate-title" we fire a single `sendToAgentChat` so the agent
 * picks up the delegation — exactly once per (recordingId, requestedAt).
 *
 * Once dispatched we DELETE the request entry so the next page load / tab
 * switch doesn't re-fire. The agent is in charge from that point on; when it
 * calls `update-recording --title=...` the polling layer will flip the
 * skeleton in `recording-card` / `r.$recordingId` over to the real title.
 *
 * This keeps the UI in charge of every LLM call (Rule 1: all AI goes through
 * the agent chat) while letting the server signal "please auto-title this
 * recording" from a request-transcript fire-and-forget where `postMessage`
 * isn't available.
 */

import { useEffect, useRef } from "react";
import { sendToAgentChat } from "@agent-native/core/client";
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
  message?: string;
}

async function readRequest(recordingId: string): Promise<AiRequest | null> {
  const url = `/_agent-native/application-state/${encodeURIComponent(
    `clips-ai-request-${recordingId}`,
  )}`;
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
  const url = `/_agent-native/application-state/${encodeURIComponent(
    `clips-ai-request-${recordingId}`,
  )}`;
  await fetch(url, { method: "DELETE" }).catch(() => {});
}

/**
 * Mount this once in the app shell. It polls the recording list and fires
 * `sendToAgentChat` for every pending auto-title request queued by the
 * server. Idempotent — a given (recordingId, requestedAt) is only dispatched
 * once per tab session.
 */
export function useAutoTitleBridge(): void {
  // Use the "all" view so we catch recordings regardless of where the user
  // is currently browsing (library root vs. a folder vs. a space).
  // Polling is disabled by default; it only activates when untitled recordings
  // exist (handled by useRecordings' conditional refetchInterval).
  const { data } = useRecordings({ view: "all", limit: 200 });
  const recordings: RecordingSummary[] = data?.recordings ?? [];
  const dispatched = useRef<Set<string>>(new Set());
  const inflight = useRef<boolean>(false);

  const untitledRecordings = recordings.filter(
    (r) => r.status === "ready" && isDefaultTitle(r.title),
  );

  useEffect(() => {
    if (untitledRecordings.length === 0) return;
    let cancelled = false;

    async function tick() {
      if (cancelled || inflight.current) return;
      inflight.current = true;
      try {
        for (const rec of untitledRecordings) {
          if (cancelled) return;
          if (dispatched.current.has(rec.id)) continue;

          const request = await readRequest(rec.id);

          if (request?.kind === "regenerate-title") {
            // Server queued a delegation — use the full context it provided.
            const dispatchKey = `${rec.id}:${request.requestedAt ?? "0"}`;
            if (dispatched.current.has(dispatchKey)) continue;

            dispatched.current.add(rec.id);
            dispatched.current.add(dispatchKey);

            sendToAgentChat({
              message:
                request.message ??
                `Generate a concise 3-8 word title for recording ${rec.id} from its transcript, then call update-recording --id=${rec.id} --title="...".`,
              context: JSON.stringify({
                recordingId: rec.id,
                currentTitle: request.currentTitle ?? rec.title,
                transcript: request.transcriptText ?? "",
                transcriptStatus: request.transcriptStatus ?? "ready",
              }),
              submit: true,
              openSidebar: false,
            });

            void clearRequest(rec.id);
          } else {
            // No server-queued delegation. Only dispatch the fallback for
            // recordings that are old enough (>2 min) that the server has had
            // ample time to write its own clips-ai-request entry. For freshly-
            // finalized clips the server request may still be en route; if we
            // mark the recording as dispatched now we'd block that richer
            // transcript-backed delegation from ever firing.
            const ageMs = Date.now() - new Date(rec.createdAt).getTime();
            const TWO_MINUTES_MS = 2 * 60 * 1000;
            if (ageMs < TWO_MINUTES_MS) continue;

            dispatched.current.add(rec.id);

            sendToAgentChat({
              message: `This clip (${rec.id}) still has its default title. Please read its transcript via get-recording-player-data and generate a concise 3-8 word title, then call update-recording --id=${rec.id} --title="...".`,
              context: JSON.stringify({
                recordingId: rec.id,
                currentTitle: rec.title,
              }),
              submit: true,
              openSidebar: false,
            });
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
  }, [untitledRecordings.map((r) => r.id).join(",")]);
}
