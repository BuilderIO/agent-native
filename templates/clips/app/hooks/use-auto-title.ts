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
  const { data } = useRecordings({ view: "all", limit: 200 });
  const recordings: RecordingSummary[] = data?.recordings ?? [];
  const dispatched = useRef<Set<string>>(new Set());
  const inflight = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled || inflight.current) return;
      inflight.current = true;
      try {
        for (const rec of recordings) {
          if (cancelled) return;
          if (rec.status !== "ready") continue;
          if (!isDefaultTitle(rec.title)) continue;
          if (dispatched.current.has(rec.id)) continue;

          const request = await readRequest(rec.id);
          if (!request || request.kind !== "regenerate-title") continue;
          const dispatchKey = `${rec.id}:${request.requestedAt ?? "0"}`;
          if (dispatched.current.has(dispatchKey)) continue;

          dispatched.current.add(rec.id);
          dispatched.current.add(dispatchKey);

          // Fire the delegation. The agent's system prompt already teaches
          // it to call `update-recording --title=...`; we just hand it the
          // transcript + recordingId so it doesn't need another round-trip
          // to load the clip.
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

          // Clear the queue entry so a reload doesn't dispatch again.
          void clearRequest(rec.id);
        }
      } finally {
        inflight.current = false;
      }
    }

    // Run immediately and on an interval. Polling is cheap (HEAD-style reads
    // from application_state) and only scales with default-title recordings.
    tick();
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recordings.length,
    recordings.map((r) => r.id + ":" + r.title).join(","),
  ]);
}
