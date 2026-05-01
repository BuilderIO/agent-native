/**
 * Auto-title bridge
 *
 * Watches the `clips-ai-request-:id` application_state queue for default-title
 * follow-up. The normal path is server-side Builder title generation; this
 * bridge handles setup prompts (connect Builder) and the legacy agent-chat
 * fallback exactly once per (recordingId, requestedAt).
 *
 * Once handled we DELETE the request entry so the next page load / tab switch
 * doesn't re-fire. The polling layer flips the skeleton in `recording-card` /
 * `r.$recordingId` over to the real title when `update-recording` lands.
 */

import { useEffect, useRef } from "react";
import { agentNativePath, sendToAgentChat } from "@agent-native/core/client";
import { useRecordings, type RecordingSummary } from "./use-library";
import { toast } from "sonner";

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
  requiresBuilderConnection?: boolean;
  message?: string;
}

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

          const request = await readRequest(rec.id);

          if (request?.kind === "regenerate-title") {
            // Server queued a delegation — use the full context it provided.
            // Key includes requestedAt so each distinct server request fires
            // exactly once, independent of any prior fallback dispatch.
            const dispatchKey = `${rec.id}:${request.requestedAt ?? "0"}`;
            if (dispatched.current.has(dispatchKey)) continue;
            dispatched.current.add(dispatchKey);

            if (request.requiresBuilderConnection) {
              toast("Connect Builder.io to generate Clip titles", {
                description:
                  "Clips uses Builder's Gemini Flash-Lite model for transcript-based default titles.",
                action: {
                  label: "Connect",
                  onClick: () => {
                    window.open(
                      agentNativePath("/_agent-native/builder/connect"),
                      "_blank",
                      "noopener,noreferrer",
                    );
                  },
                },
              });
              void clearRequest(rec.id);
              continue;
            }

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
  }, [untitledRecordings.map((r) => r.id).join(",")]);
}
