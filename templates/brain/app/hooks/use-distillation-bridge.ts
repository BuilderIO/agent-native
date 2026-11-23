import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import {
  compareAndSetClientAppState,
  readClientAppState,
} from "@agent-native/core/client/application-state";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";

import type { BrainCaptureReviewItem, CapturesResponse } from "@/lib/brain";

import {
  intelligenceDistillationInstructions,
  KNOWLEDGE_UPDATE_INSTRUCTIONS,
} from "../../shared/intelligence-distillation";

const POLL_INTERVAL_MS = 5000;
const FORBIDDEN_CLAIM_RETRY_MS = 60_000;

interface DistillationRequest extends Record<string, unknown> {
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

async function failClaim(
  captureId: string,
  queueId: string,
  claimToken: string,
  reason: "cancelled" | "delivery-unknown" | "read-unavailable",
): Promise<void> {
  const result = await callAction("release-distillation", {
    captureId,
    queueId,
    claimToken,
    reason,
  });
  if (!result.released)
    throw new Error("Distillation claim could not be recorded as failed.");
}

export function useDistillationBridge(): void {
  const dispatched = useRef<Set<string>>(new Set());
  const inflight = useRef(false);
  const forbiddenClaims = useRef<Map<string, number>>(new Map());
  const capturesQuery = useActionQuery<CapturesResponse>(
    "list-captures",
    {
      status: "distilling",
      limit: 50,
    },
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
  const mounted = useRef(false);
  const isMounted = () => mounted.current;
  const currentCaptures = useRef<BrainCaptureReviewItem[] | null>(null);
  const captureWaiters = useRef(new Set<() => void>());
  currentCaptures.current = capturesQuery.isError
    ? null
    : (capturesQuery.data?.captures ?? null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      captureWaiters.current.forEach((resolve) => resolve());
      captureWaiters.current.clear();
    };
  }, []);
  useEffect(() => {
    captureWaiters.current.forEach((resolve) => resolve());
    captureWaiters.current.clear();
  }, [capturesQuery.isError, capturesQuery.dataUpdatedAt, capturesQuery.data]);
  const isCurrent = (capture: BrainCaptureReviewItem) =>
    mounted.current &&
    currentCaptures.current !== null &&
    currentCaptures.current.some(
      (current) =>
        current.id === capture.id &&
        current.distillationQueue?.id === capture.distillationQueue?.id &&
        current.distillationQueue?.status === "queued" &&
        current.distillationQueue.updatedAt ===
          capture.distillationQueue?.updatedAt,
    );
  async function readClaimedCapture(
    captureId: string,
    queueId: string,
    claimedAt: string,
  ) {
    for (let attempt = 0; attempt < 3 && mounted.current; attempt++) {
      try {
        const result = await callAction(
          "list-captures",
          {
            status: "distilling",
            captureId,
            limit: 1,
          },
          { method: "GET" },
        );
        const captures = z
          .object({ captures: z.array(z.unknown()) })
          .parse(result).captures as BrainCaptureReviewItem[];
        return (
          captures.find(
            (item) =>
              item.id === captureId &&
              item.distillationQueue?.id === queueId &&
              item.distillationQueue.status === "processing" &&
              item.distillationQueue.updatedAt === claimedAt,
          ) ?? null
        );
      } catch (error) {
        reportWriteFailure(error);
        if (!isMounted()) return null;
        if (attempt === 2) throw error;
        await new Promise<void>((resolve) => {
          const wake = () => {
            clearTimeout(timer);
            captureWaiters.current.delete(wake);
            resolve();
          };
          const timer = setTimeout(wake, POLL_INTERVAL_MS);
          captureWaiters.current.add(wake);
        });
      }
    }
    return null;
  }
  const capturesKey = dispatchableCaptures
    .map((capture) => {
      const queue = capture.distillationQueue;
      return `${capture.id}:${queue?.id ?? ""}:${queue?.updatedAt ?? ""}`;
    })
    .join("|");

  useEffect(() => {
    if (!dispatchableCaptures.length) return;

    async function tick() {
      if (!mounted.current || inflight.current) return;
      inflight.current = true;
      try {
        for (const capture of dispatchableCaptures) {
          try {
            if (!isCurrent(capture)) continue;
            const runAfter = capture.distillationQueue?.runAfter;
            if (runAfter && runAfter > new Date().toISOString()) continue;
            const request = await readClientAppState<DistillationRequest>(
              `brain-distill-request-${capture.id}`,
            );
            if (!isCurrent(capture)) continue;
            if (request === null) continue;
            if (
              request.kind !== "distill-capture" ||
              request.captureId !== capture.id
            ) {
              throw new Error("Invalid distillation request.");
            }
            const queueId = capture.distillationQueue?.id ?? request.queueId;
            if (request.queueId && queueId && request.queueId !== queueId) {
              throw new Error(
                "Distillation request does not match its queue item.",
              );
            }
            const dispatchKey = `${capture.id}:${queueId ?? ""}:${
              request.requestedAt ?? "0"
            }`;
            if (dispatched.current.has(dispatchKey)) continue;
            const retryAfter = forbiddenClaims.current.get(dispatchKey);
            if (retryAfter !== undefined && Date.now() < retryAfter) continue;
            if (!queueId)
              throw new Error("Distillation request has no queue ID.");
            let claimResponse: unknown;
            try {
              claimResponse = await callAction("claim-distillation", {
                captureId: capture.id,
                queueId,
              });
            } catch (error) {
              if ((error as { status?: unknown }).status === 403) {
                forbiddenClaims.current.set(
                  dispatchKey,
                  Date.now() + FORBIDDEN_CLAIM_RETRY_MS,
                );
                continue;
              }
              throw error;
            }
            const claim = z
              .object({
                claimed: z.boolean(),
                claimToken: z.string().nullable().optional(),
                queueItem: z
                  .object({ updatedAt: z.string() })
                  .nullable()
                  .optional(),
              })
              .parse(claimResponse);
            if (!claim.claimed) continue;
            if (typeof claim.claimToken !== "string" || !claim.claimToken) {
              throw new Error("Distillation claim returned no claim token.");
            }
            const claimToken = claim.claimToken;
            if (!claim.queueItem?.updatedAt)
              throw new Error("Distillation claim returned no queue version.");
            let freshCapture: BrainCaptureReviewItem | null;
            try {
              freshCapture = await readClaimedCapture(
                capture.id,
                queueId,
                claim.queueItem.updatedAt,
              );
            } catch (error) {
              await failClaim(
                capture.id,
                queueId,
                claimToken,
                "read-unavailable",
              );
              throw error;
            }
            if (!freshCapture || !isMounted()) {
              await failClaim(capture.id, queueId, claimToken, "cancelled");
              if (!isMounted()) return;
              continue;
            }
            dispatched.current.add(dispatchKey);

            const delivery = await sendToAgentChatAndConfirm({
              message: buildMessage(freshCapture, queueId, claimToken),
              context: JSON.stringify(
                {
                  request: { ...request, claimToken },
                  capture: summarizeCapture(freshCapture),
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
              chatTarget: "local",
            });
            if (!delivery.delivered) {
              await failClaim(
                capture.id,
                queueId,
                claimToken,
                delivery.reason === "no-window" ||
                  delivery.reason === "unsupported-target"
                  ? "cancelled"
                  : "delivery-unknown",
              );
              throw new Error(
                `Distillation delivery was not confirmed: ${delivery.reason ?? "unknown"}.`,
              );
            }
            await compareAndSetClientAppState(
              `brain-distill-request-${capture.id}`,
              request,
              null,
            );
          } catch (error) {
            reportWriteFailure(error);
          }
        }
      } catch (error) {
        reportWriteFailure(error);
      } finally {
        inflight.current = false;
      }
    }

    void tick();
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
    `validation. Treat short dated company launch announcements as retainable ` +
    `plans, not proof of a completed launch; write supported knowledge with ` +
    `write-knowledge for other durable entries. ` +
    KNOWLEDGE_UPDATE_INSTRUCTIONS +
    intelligenceDistillationInstructions(capture.id) +
    `Ignore only if no company-relevant ` +
    `fact remains. Mark the capture distilled or ignored with queueId ${queueId} and ` +
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
