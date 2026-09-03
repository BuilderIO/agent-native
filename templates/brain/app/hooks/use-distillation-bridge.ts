import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useMemo, useRef } from "react";

import type { BrainCaptureReviewItem, CapturesResponse } from "@/lib/brain";

const POLL_INTERVAL_MS = 5000;

interface DistillationRequest {
  kind?: string;
  captureId?: string;
  queueId?: string;
  sourceId?: string;
  claimToken?: string;
  requestedAt?: string;
  instructions?: string | null;
  guidance?: Record<string, unknown>;
  message?: string;
}

async function readRequest(
  captureId: string,
): Promise<DistillationRequest | null> {
  try {
    const res = await fetch(
      agentNativePath(
        `/_agent-native/application-state/${encodeURIComponent(
          `brain-distill-request-${captureId}`,
        )}`,
      ),
    );
    if (!res.ok) return null;
    const payload = await res.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;
    return ((payload as any).value ?? payload) as DistillationRequest;
  } catch {
    return null;
  }
}

async function clearRequest(captureId: string): Promise<void> {
  await fetch(
    agentNativePath(
      `/_agent-native/application-state/${encodeURIComponent(
        `brain-distill-request-${captureId}`,
      )}`,
    ),
    { method: "DELETE" },
  ).catch(() => {});
}

async function claimDistillation(
  captureId: string,
  queueId?: string,
): Promise<string | null> {
  try {
    const payload = await callAction(
      "claim-distillation" as any,
      { captureId, queueId } as any,
    );
    return payload?.claimed && typeof payload.claimToken === "string"
      ? payload.claimToken
      : null;
  } catch {
    return null;
  }
}

export function useDistillationBridge(): void {
  const dispatched = useRef<Set<string>>(new Set());
  const inflight = useRef(false);
  const capturesQuery = useActionQuery<CapturesResponse>(
    "list-captures" as any,
    {
      status: "distilling",
      limit: 50,
    } as any,
    {
      refetchInterval: POLL_INTERVAL_MS,
      retry: false,
    },
  );

  const dispatchableCaptures = useMemo<BrainCaptureReviewItem[]>(
    () =>
      ((capturesQuery.data?.captures ?? []) as BrainCaptureReviewItem[]).filter(
        (capture) => {
          const queue = capture.distillationQueue;
          return queue?.status === "queued";
        },
      ),
    [capturesQuery.data?.captures],
  );
  const capturesKey = dispatchableCaptures
    .map((capture) => {
      const queue = capture.distillationQueue;
      return `${capture.id}:${queue?.id ?? ""}:${queue?.updatedAt ?? ""}`;
    })
    .join("|");

  useEffect(() => {
    if (!dispatchableCaptures.length) return;
    let cancelled = false;

    async function tick() {
      if (cancelled || inflight.current) return;
      inflight.current = true;
      try {
        for (const capture of dispatchableCaptures) {
          if (cancelled) return;
          const request = await readRequest(capture.id);
          if (
            request?.kind !== "distill-capture" ||
            request.captureId !== capture.id
          ) {
            continue;
          }
          const queueId = capture.distillationQueue?.id ?? request.queueId;
          if (request.queueId && queueId && request.queueId !== queueId) {
            continue;
          }
          const dispatchKey = `${capture.id}:${queueId ?? ""}:${
            request.requestedAt ?? "0"
          }`;
          if (dispatched.current.has(dispatchKey)) continue;
          const claimToken = await claimDistillation(capture.id, queueId);
          if (!claimToken || !queueId) continue;
          dispatched.current.add(dispatchKey);

          sendToAgentChat({
            message: buildMessage(capture, queueId, claimToken),
            context: JSON.stringify(
              {
                request: { ...request, claimToken },
                capture: summarizeCapture(capture),
                instructions: request.instructions ?? undefined,
                guidance: request.guidance,
                claim: { queueId, claimToken },
              },
              null,
              2,
            ),
            submit: true,
            openSidebar: false,
            newTab: true,
            background: true,
          });
          await clearRequest(capture.id);
        }
      } finally {
        inflight.current = false;
      }
    }

    void tick();
    return () => {
      cancelled = true;
    };
    // `capturesQuery.dataUpdatedAt` bumps on every completed refetch even when
    // React Query's structural sharing keeps `capturesQuery.data` (and thus
    // `dispatchableCaptures`/`capturesKey`) referentially/content-equal to the
    // previous fetch. Keying on it (in addition to `capturesKey`) guarantees
    // this effect re-runs on the query's `refetchInterval` cadence — not just
    // when the queued-capture set actually changes — so already-fetched but
    // not-yet-claimed/dispatched items keep getting re-evaluated on every
    // poll instead of only on the tick they first appear.
  }, [capturesKey, dispatchableCaptures, capturesQuery.dataUpdatedAt]);
}

function buildMessage(
  capture: BrainCaptureReviewItem,
  queueId: string,
  claimToken: string,
) {
  return (
    `Distill Brain capture ${capture.id} (${capture.title}). ` +
    `Use get-capture with includeRawContent=true before exact quote ` +
    `validation, write durable company knowledge with write-knowledge, then ` +
    `mark the capture distilled or ignored with queueId ${queueId} and ` +
    `claimToken ${claimToken}.`
  );
}

function summarizeCapture(capture: BrainCaptureReviewItem) {
  return {
    id: capture.id,
    sourceId: capture.sourceId,
    source: capture.source,
    title: capture.title,
    kind: capture.kind,
    status: capture.status,
    capturedAt: capture.capturedAt,
    sourceUrl: capture.sourceUrl,
    distillationQueue: capture.distillationQueue,
  };
}
