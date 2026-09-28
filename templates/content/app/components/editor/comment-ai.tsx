import {
  cancelBackgroundAgentSession,
  getBackgroundAgentSessionStatus,
  requestAgentChatThreadOpen,
  startBackgroundAgentSession,
  type BackgroundAgentSessionStartOptions,
  type BackgroundAgentSessionSnapshot,
  type BackgroundAgentSessionStatus,
} from "@agent-native/core/client/agent-chat";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { InlineMarkdown } from "@agent-native/core/client/markdown";
import type {
  CommentAiIntent,
  CommentAiRequest,
  CommentAiSessionStatus,
  StartCommentAiResult,
} from "@shared/comment-ai";
import { IconCircleCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { loadCommentAiConversation } from "@/lib/comment-ai-client";
import { cn } from "@/lib/utils";

import {
  AgentAvatar,
  agentDisplayName,
  commentAiModelLabel,
  modelDisplayName,
} from "./agent-identity";
import { trimDiffContext, wordDiff } from "./comment-ai-diff";
import { CommentAgentBadge, CommentRow } from "./CommentRow";

const ACTIVE_STATUSES = new Set<CommentAiRequest["status"]>([
  "classifying",
  "classified",
  "queued",
  "running",
  "refreshing",
]);
const ACTIVE_REQUEST_REFETCH_INTERVAL_MS = 1_500;
/** A result this recent on first load still counts as just finished. */
const FRESH_RESOLUTION_WINDOW_MS = 2 * 60_000;
const CONTINUATION_CONTEXT_TURN_LIMIT = 8;
const CONTINUATION_CONTEXT_CHARACTER_LIMIT = 12_000;
const CONTINUATION_ANCHOR_CHARACTER_LIMIT = 4_000;
const CONTINUATION_OMISSION_MARKER = "[Earlier conversation omitted]";
const CONTINUATION_TRUNCATION_MARKER = "[Turn truncated]";

export function boundedContinuationContext(
  turns: Awaited<ReturnType<typeof loadCommentAiConversation>>,
) {
  const turnText = (turn: (typeof turns)[number]) =>
    [
      turn.userText ? `User: ${turn.userText}` : null,
      turn.assistantText ? `Assistant: ${turn.assistantText}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n\n");
  const rawAnchor = turns[0] ? turnText(turns[0]) : "";
  const anchor =
    rawAnchor.length > CONTINUATION_ANCHOR_CHARACTER_LIMIT
      ? `${rawAnchor.slice(
          0,
          CONTINUATION_ANCHOR_CHARACTER_LIMIT -
            CONTINUATION_TRUNCATION_MARKER.length -
            1,
        )}\n${CONTINUATION_TRUNCATION_MARKER}`
      : rawAnchor;
  const recentTranscript = turns
    .slice(-(CONTINUATION_CONTEXT_TURN_LIMIT - 1))
    .filter((turn) => turn !== turns[0])
    .flatMap((turn) => [
      turn.userText ? `User: ${turn.userText}` : null,
      turn.assistantText ? `Assistant: ${turn.assistantText}` : null,
    ])
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
  if (!recentTranscript) return anchor;

  const separator = "\n\n";
  const omission =
    turns.length > CONTINUATION_CONTEXT_TURN_LIMIT
      ? `${CONTINUATION_OMISSION_MARKER}${separator}`
      : "";
  const recentBudget = Math.max(
    CONTINUATION_TRUNCATION_MARKER.length + 1,
    CONTINUATION_CONTEXT_CHARACTER_LIMIT -
      anchor.length -
      separator.length -
      omission.length,
  );
  const recent =
    recentTranscript.length > recentBudget
      ? `${CONTINUATION_TRUNCATION_MARKER}\n${recentTranscript.slice(
          -(recentBudget - CONTINUATION_TRUNCATION_MARKER.length - 1),
        )}`
      : recentTranscript;
  return `${anchor}${separator}${omission}${recent}`;
}

export interface CommentAiContinuationState {
  operationId: string;
  threadId: string;
  turnId: string;
  status: BackgroundAgentSessionStatus;
  options?: BackgroundAgentSessionStartOptions;
  error?: string;
}

interface CommentAiDispatchRecovery {
  options: BackgroundAgentSessionStartOptions;
  phase?: "classification" | "execution";
  error?: string;
}

export interface CommentAiController {
  requests: CommentAiRequest[];
  startingThreadIds: ReadonlySet<string>;
  stoppingRequestIds: ReadonlySet<string>;
  continuations: ReadonlyMap<string, CommentAiContinuationState>;
  transcriptRevision: number;
  start(input: {
    threadId: string;
    rootCommentId: string;
    submittedMode: "auto" | CommentAiIntent;
    instructions: string;
    provider?: string;
    model?: string;
    engine?: string;
    continuationOfRequestId?: string;
    requestId?: string;
  }): Promise<"confirmed-start" | "busy">;
  continue(request: CommentAiRequest, message: string): Promise<void>;
  retry(request: CommentAiRequest): Promise<void>;
  resume(request: CommentAiRequest): Promise<void>;
  stop(request: CommentAiRequest): Promise<void>;
  open(request: CommentAiRequest): void;
  /** Reverse an applied change and reopen its thread. */
  undo(request: CommentAiRequest): Promise<void>;
  /**
   * Threads AI resolved with an applied change while this Page was open,
   * keyed by thread, until the person dismisses the result.
   */
  freshResolutions: ReadonlyMap<string, CommentAiRequest>;
  dismissResolution(threadId: string): void;
}

function isAppliedResolution(request: CommentAiRequest) {
  return (
    request.status === "resolved" &&
    Boolean(request.result?.editApplied) &&
    !request.result?.undone
  );
}

/**
 * Keeps a thread that AI just resolved in view until the person is done with
 * it, instead of letting it vanish from the margin mid-read.
 */
export function useFreshAiResolutions(
  requests: CommentAiRequest[],
  now: () => number = Date.now,
) {
  const knownRef = useRef(new Map<string, CommentAiRequest["status"]>());
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    const added: string[] = [];
    for (const request of requests) {
      const prior = knownRef.current.get(request.operationId);
      knownRef.current.set(request.operationId, request.status);
      if (!isAppliedResolution(request)) continue;
      const finishedWhileOpen =
        prior !== undefined && ACTIVE_STATUSES.has(prior);
      const finishedJustBefore =
        prior === undefined &&
        now() - Date.parse(request.updatedAt) < FRESH_RESOLUTION_WINDOW_MS;
      if (finishedWhileOpen || finishedJustBefore)
        added.push(request.operationId);
    }
    if (added.length) {
      setFreshIds((current) => new Set([...current, ...added]));
    }
  }, [now, requests]);
  const freshResolutions = useMemo(() => {
    const byThread = new Map<string, CommentAiRequest>();
    for (const request of requests) {
      if (freshIds.has(request.operationId) && isAppliedResolution(request)) {
        byThread.set(request.threadId, request);
      }
    }
    return byThread;
  }, [freshIds, requests]);
  const dismissResolution = useCallback(
    (threadId: string) =>
      setFreshIds((current) => {
        const next = new Set(current);
        for (const request of requests) {
          if (request.threadId === threadId) next.delete(request.operationId);
        }
        return next.size === current.size ? current : next;
      }),
    [requests],
  );
  return { freshResolutions, dismissResolution };
}

export function startCommentAiSubmission(
  controller: Pick<CommentAiController, "start">,
  input: {
    threadId: string;
    rootCommentId: string;
    submittedMode: "auto" | CommentAiIntent;
    instructions: string;
    provider?: string;
    model?: string;
    engine?: string;
    priorRequest?: CommentAiRequest;
  },
) {
  return controller.start({
    threadId: input.threadId,
    rootCommentId: input.rootCommentId,
    submittedMode: input.submittedMode,
    instructions: input.instructions,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.engine ? { engine: input.engine } : {}),
    ...(input.priorRequest
      ? { continuationOfRequestId: input.priorRequest.requestId }
      : {}),
  });
}

export function acknowledgeCommentAiContinuation(
  current: Record<string, CommentAiContinuationState>,
  requestId: string,
  turnId: string,
) {
  const observed = current[requestId];
  if (!observed || observed.turnId !== turnId || observed.status !== "queued")
    return current;
  return {
    ...current,
    [requestId]: { ...observed, status: "running" as const },
  };
}

export function shouldIgnoreContinuationAcceptanceError(
  observed: CommentAiContinuationState | undefined,
  turnId: string,
) {
  return Boolean(
    observed &&
    observed.turnId === turnId &&
    observed.status !== "queued" &&
    observed.status !== "running" &&
    observed.status !== "unavailable",
  );
}

export function commentAiRequestsRefetchInterval(
  data: unknown,
): number | false {
  if (!data || typeof data !== "object" || !("requests" in data)) return false;
  const requests = (data as { requests?: unknown }).requests;
  return Array.isArray(requests) &&
    requests.some(
      (request) =>
        request &&
        typeof request === "object" &&
        "status" in request &&
        ACTIVE_STATUSES.has((request as CommentAiRequest).status),
    )
    ? ACTIVE_REQUEST_REFETCH_INTERVAL_MS
    : false;
}

export function latestCommentAiRequest(
  requests: readonly CommentAiRequest[],
  threadId: string,
): CommentAiRequest | undefined {
  return requests
    .filter((request) => request.threadId === threadId)
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0];
}

function sessionReceipt(request: CommentAiRequest) {
  if (request.pendingSession) {
    return {
      operationId: request.operationId,
      threadId: request.pendingSession.backgroundSession.threadId,
      turnId: request.pendingSession.backgroundSession.turnId,
    };
  }
  if (!request.agentThreadId || !request.agentTurnId) return null;
  return {
    operationId: request.operationId,
    threadId: request.agentThreadId,
    turnId: request.agentTurnId,
  };
}

export function shouldReconcileCommentAiSnapshot(
  snapshot: BackgroundAgentSessionSnapshot,
) {
  if (snapshot.status === "queued" || snapshot.status === "running")
    return false;
  // An exact receipt can be temporarily invisible while dispatch or scoped
  // authorization catches up. A terminal label without a durable run identity
  // can likewise come from the transport boundary before dispatch reaches the
  // run manager; neither observation has authority to finish the operation.
  return snapshot.status !== "unavailable" && Boolean(snapshot.runId);
}

export function useCommentAiRequests(
  documentId: string,
  options: { enabled: boolean },
): CommentAiController {
  const query = useActionQuery<{ requests: CommentAiRequest[] }>(
    "list-comment-ai-requests",
    { documentId },
    {
      enabled: options.enabled,
      refetchInterval: (state) =>
        commentAiRequestsRefetchInterval(state.state.data),
    },
  );
  const serverRequests = query.data?.requests ?? [];
  const serverRequestsRef = useRef(serverRequests);
  serverRequestsRef.current = serverRequests;
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  const mountedRef = useRef(true);
  const monitoredRequestsRef = useRef(new Set<string>());
  const monitoredContinuationsRef = useRef(new Set<string>());
  const startingRef = useRef(new Set<string>());
  const [startingThreadIds, setStartingThreadIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [stoppingRequestIds, setStoppingRequestIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [dispatchRecoveryRecord, setDispatchRecoveryRecord] = useLocalStorage<
    Record<string, CommentAiDispatchRecovery>
  >(`content-comment-ai-dispatch-recovery:${documentId}`, {});
  const [continuationRecord, setContinuationRecord] = useLocalStorage<
    Record<string, CommentAiContinuationState>
  >(`content-comment-ai-continuations:${documentId}`, {});
  const requests = useMemo(
    () =>
      serverRequests.map((request) => {
        const recovery = dispatchRecoveryRecord[request.operationId];
        const continuation = continuationRecord[request.operationId];
        const error = recovery?.error ?? continuation?.error;
        if (
          !error ||
          (!ACTIVE_STATUSES.has(request.status) &&
            continuation?.status !== "unavailable")
        )
          return request;
        return {
          ...request,
          status: "needs-review" as const,
          errorCode: "operation_failed" as const,
          error,
          transportUnknown: true,
        };
      }),
    [continuationRecord, dispatchRecoveryRecord, serverRequests],
  );
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const continuations = useMemo(
    () => new Map(Object.entries(continuationRecord)),
    [continuationRecord],
  );
  const continuationRecordRef = useRef(continuationRecord);
  continuationRecordRef.current = continuationRecord;
  const updateContinuation = useCallback(
    (operationId: string, state: CommentAiContinuationState) => {
      continuationRecordRef.current = {
        ...continuationRecordRef.current,
        [operationId]: state,
      };
      setContinuationRecord((current) => {
        const next = { ...current, [operationId]: state };
        continuationRecordRef.current = next;
        return next;
      });
    },
    [setContinuationRecord],
  );
  const [transcriptRevision, setTranscriptRevision] = useState(0);
  const t = useT();

  const dispatch = useCallback(
    async (
      requestId: string,
      options: BackgroundAgentSessionStartOptions,
      phase?: "classification" | "execution",
    ) => {
      setDispatchRecoveryRecord((current) => ({
        ...current,
        [requestId]: { options, phase },
      }));
      const handle = startBackgroundAgentSession(options);
      try {
        await handle.accepted;
        setDispatchRecoveryRecord((current) => {
          if (!current[requestId]) return current;
          const next = { ...current };
          delete next[requestId];
          return next;
        });
        await refetchRef.current();
      } catch (error) {
        let snapshot: Awaited<ReturnType<typeof handle.status>> | undefined;
        let statusError: unknown;
        try {
          snapshot = await handle.status();
        } catch (caughtStatusError) {
          statusError = caughtStatusError;
        }
        if (snapshot && shouldReconcileCommentAiSnapshot(snapshot)) {
          setDispatchRecoveryRecord((current) => {
            if (!current[requestId]) return current;
            const next = { ...current };
            delete next[requestId];
            return next;
          });
          await refetchRef.current();
          return;
        }
        setDispatchRecoveryRecord((current) => ({
          ...current,
          [requestId]: {
            options,
            phase,
            error: [
              error instanceof Error
                ? error.message
                : t("comments.aiRequestCouldNotBeConfirmed"),
              statusError instanceof Error ? statusError.message : undefined,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        }));
      }
    },
    [setDispatchRecoveryRecord],
  );

  const reconcile = useCallback(
    async (
      request: CommentAiRequest,
      threadId: string,
      turnId: string,
      status: CommentAiSessionStatus,
      runId?: string,
      terminalReason?: string | null,
    ) => {
      await callAction("reconcile-comment-ai-session", {
        operationId: request.operationId,
        threadId,
        turnId,
        status,
        ...(runId ? { runId } : {}),
        ...(terminalReason ? { terminalReason } : {}),
      });
      await refetchRef.current();
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    for (const request of serverRequests) {
      const receipt = sessionReceipt(request);
      if (
        !ACTIVE_STATUSES.has(request.status) ||
        !receipt ||
        monitoredRequestsRef.current.has(request.operationId)
      )
        continue;
      monitoredRequestsRef.current.add(request.operationId);
      void (async () => {
        let retryDelay = ACTIVE_REQUEST_REFETCH_INTERVAL_MS;
        try {
          while (
            mountedRef.current &&
            serverRequestsRef.current.some(
              (current) =>
                current.operationId === request.operationId &&
                ACTIVE_STATUSES.has(current.status),
            )
          ) {
            let snapshot;
            try {
              snapshot = await getBackgroundAgentSessionStatus(receipt);
              retryDelay = ACTIVE_REQUEST_REFETCH_INTERVAL_MS;
            } catch {
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
              retryDelay = Math.min(retryDelay * 2, 10_000);
              continue;
            }
            if (shouldReconcileCommentAiSnapshot(snapshot)) {
              await reconcile(
                request,
                receipt.threadId,
                receipt.turnId,
                snapshot.status,
                snapshot.runId,
                snapshot.terminalReason,
              );
              return;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, ACTIVE_REQUEST_REFETCH_INTERVAL_MS),
            );
          }
        } finally {
          monitoredRequestsRef.current.delete(request.operationId);
        }
      })();
    }
  }, [reconcile, serverRequests]);

  const resumedPendingRequestsRef = useRef(new Set<string>());
  const start = useCallback<CommentAiController["start"]>(
    async ({
      threadId,
      rootCommentId,
      submittedMode,
      instructions,
      provider,
      model,
      engine,
      continuationOfRequestId,
      requestId: retryRequestId,
    }) => {
      const recovery = retryRequestId
        ? dispatchRecoveryRecord[retryRequestId]
        : undefined;
      const continuationRecovery = retryRequestId
        ? continuationRecordRef.current[retryRequestId]
        : undefined;
      const active = serverRequestsRef.current.some(
        (request) =>
          request.threadId === threadId && ACTIVE_STATUSES.has(request.status),
      );
      if (
        (active &&
          !retryRequestId &&
          !recovery &&
          !continuationRecovery?.error) ||
        startingRef.current.has(threadId)
      )
        return "busy";

      const requestId = retryRequestId ?? globalThis.crypto.randomUUID();
      startingRef.current.add(threadId);
      setStartingThreadIds(new Set(startingRef.current));
      let started: StartCommentAiResult | null = null;
      try {
        if (continuationRecovery?.options && continuationRecovery.error) {
          const retrying = {
            ...continuationRecovery,
            status: "queued" as const,
            error: undefined,
          };
          updateContinuation(requestId, retrying);
          const handle = startBackgroundAgentSession(
            continuationRecovery.options,
          );
          try {
            await handle.accepted;
            const observed = continuationRecordRef.current[requestId];
            if (
              observed?.turnId === retrying.turnId &&
              observed.status === "queued"
            ) {
              updateContinuation(requestId, {
                ...observed,
                status: "running",
              });
            }
          } catch (error) {
            const observed = continuationRecordRef.current[requestId];
            if (
              !shouldIgnoreContinuationAcceptanceError(
                observed,
                retrying.turnId,
              )
            ) {
              updateContinuation(requestId, {
                ...retrying,
                status: "unavailable",
                error:
                  error instanceof Error
                    ? error.message
                    : t("comments.aiFollowUpCouldNotBeConfirmed"),
              });
            }
          }
          return "confirmed-start";
        }
        if (recovery) {
          await dispatch(requestId, recovery.options, recovery.phase);
          return "confirmed-start";
        }
        started = await callAction<StartCommentAiResult>(
          "start-comment-ai-request",
          {
            documentId,
            threadId,
            rootCommentId,
            submittedMode,
            instructions,
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(engine ? { engine } : {}),
            ...(continuationOfRequestId ? { continuationOfRequestId } : {}),
            requestId,
          },
        );
        if (started.outcome === "busy") {
          await query.refetch();
          return "busy";
        }
        if (started.dispatch) {
          const pendingSession =
            started.pendingSession ??
            ({
              phase: "execution",
              backgroundSession: started.backgroundSession,
              prompt: started.prompt,
              context: started.context,
            } as const);
          resumedPendingRequestsRef.current.add(
            `${started.operationId}:${started.status}`,
          );
          const options = {
            message: pendingSession.prompt,
            instructions: pendingSession.context,
            ...pendingSession.backgroundSession,
            usageLabel: "content:comment-ai",
          } satisfies BackgroundAgentSessionStartOptions;
          void dispatch(requestId, options, pendingSession.phase);
        }
        await query.refetch();
        return "confirmed-start";
      } catch (error) {
        throw error;
      } finally {
        startingRef.current.delete(threadId);
        setStartingThreadIds(new Set(startingRef.current));
      }
    },
    [dispatch, dispatchRecoveryRecord, documentId, query, updateContinuation],
  );

  useEffect(() => {
    for (const request of serverRequests) {
      if (
        (request.status !== "classifying" && request.status !== "classified") ||
        resumedPendingRequestsRef.current.has(
          `${request.operationId}:${request.status}`,
        )
      )
        continue;
      const resumeKey = `${request.operationId}:${request.status}`;
      resumedPendingRequestsRef.current.add(resumeKey);
      void start({
        threadId: request.threadId,
        rootCommentId: request.rootCommentId,
        submittedMode: request.submittedMode ?? request.intent ?? "auto",
        instructions: request.instructions ?? t("comments.retry"),
        ...(request.submittedProvider
          ? { provider: request.submittedProvider }
          : {}),
        ...(request.submittedModel ? { model: request.submittedModel } : {}),
        ...(request.submittedEngine ? { engine: request.submittedEngine } : {}),
        ...(request.continuationOfRequestId
          ? { continuationOfRequestId: request.continuationOfRequestId }
          : {}),
        requestId: request.requestId,
      }).catch(() => resumedPendingRequestsRef.current.delete(resumeKey));
    }
  }, [serverRequests, start, t]);

  const monitorContinuation = useCallback(
    async (request: CommentAiRequest, receipt: CommentAiContinuationState) => {
      if (monitoredContinuationsRef.current.has(receipt.turnId)) return;
      monitoredContinuationsRef.current.add(receipt.turnId);
      let retryDelay = ACTIVE_REQUEST_REFETCH_INTERVAL_MS;
      try {
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          if (!mountedRef.current) return;
          let snapshot;
          try {
            snapshot = await getBackgroundAgentSessionStatus({
              operationId: receipt.operationId,
              threadId: receipt.threadId,
              turnId: receipt.turnId,
            });
            retryDelay = ACTIVE_REQUEST_REFETCH_INTERVAL_MS;
          } catch {
            retryDelay = Math.min(retryDelay * 2, 10_000);
            continue;
          }
          if (snapshot.status !== "unavailable") {
            updateContinuation(request.operationId, {
              ...receipt,
              status: snapshot.status,
              ...(snapshot.terminalReason
                ? { error: snapshot.terminalReason }
                : {}),
            });
          }
          if (shouldReconcileCommentAiSnapshot(snapshot)) {
            setTranscriptRevision((value) => value + 1);
            return;
          }
        }
      } finally {
        monitoredContinuationsRef.current.delete(receipt.turnId);
      }
    },
    [updateContinuation],
  );

  useEffect(() => {
    for (const [operationId, continuation] of continuations) {
      if (continuation.status !== "queued" && continuation.status !== "running")
        continue;
      const request = serverRequests.find(
        (candidate) => candidate.operationId === operationId,
      );
      if (request) void monitorContinuation(request, continuation);
    }
  }, [continuations, monitorContinuation, serverRequests]);

  const dispatchContinuation = useCallback(
    async (
      request: CommentAiRequest,
      message: string,
      mode: "follow-up" | "resume",
    ) => {
      if (!request.agentThreadId) {
        throw new Error("This AI conversation is not available yet");
      }
      const existing = continuationRecordRef.current[request.operationId];
      if (
        existing &&
        (existing.status === "queued" ||
          existing.status === "running" ||
          existing.status === "unavailable")
      ) {
        throw new Error(
          existing.error ?? "This AI follow-up is already in progress",
        );
      }
      const operationId = globalThis.crypto.randomUUID();
      let continuation: CommentAiContinuationState | null = null;
      try {
        // Background sessions submit an empty model history. Rehydrate a
        // bounded transcript from this request's protected thread instead.
        const priorConversation = boundedContinuationContext(
          await loadCommentAiConversation({
            operationId: request.operationId,
            agentThreadId: request.agentThreadId,
            initialTurnId: "",
          }),
        );
        const options = {
          message,
          operationId,
          threadId: request.agentThreadId,
          scope: { type: "content-comment-ai", id: request.operationId },
          actionScope: {
            kind: "content-comment-ai",
            requestId: request.operationId,
          },
          instructions:
            (mode === "resume"
              ? "Resume this unfinished comment AI operation from its durable action state. Complete only the remaining steps, using the same action scope and idempotent domain operation. Do not repeat a completed edit or create a duplicate receipt."
              : "Continue this comment AI conversation and answer the follow-up directly. Keep the original intent and action scope. Do not repeat a completed comment action or create a duplicate receipt.") +
            (priorConversation
              ? `\n\nProtected conversation context:\n\n${priorConversation}`
              : ""),
          ...(request.model ? { model: request.model } : {}),
          usageLabel:
            mode === "resume"
              ? "content:comment-ai-resume"
              : "content:comment-ai-follow-up",
        } satisfies BackgroundAgentSessionStartOptions;
        const handle = startBackgroundAgentSession(options);
        continuation = {
          operationId: handle.operationId,
          threadId: handle.threadId,
          turnId: handle.turnId,
          status: "queued" as const,
          options,
        };
        updateContinuation(request.operationId, continuation);
        void monitorContinuation(request, continuation);
        await handle.accepted;
        const observed = continuationRecordRef.current[request.operationId];
        if (
          observed?.turnId === continuation.turnId &&
          observed.status === "queued"
        ) {
          updateContinuation(request.operationId, {
            ...observed,
            status: "running",
          });
        }
      } catch (error) {
        if (continuation) {
          const observed = continuationRecordRef.current[request.operationId];
          if (
            shouldIgnoreContinuationAcceptanceError(
              observed,
              continuation.turnId,
            )
          ) {
            return;
          }
          if (
            observed &&
            observed.turnId === continuation.turnId &&
            (observed.status === "queued" || observed.status === "running")
          ) {
            updateContinuation(request.operationId, {
              ...observed,
              status: "unavailable",
              error: error instanceof Error ? error.message : undefined,
            });
          }
        }
        throw error;
      }
    },
    [monitorContinuation, updateContinuation],
  );

  const continueConversation = useCallback<CommentAiController["continue"]>(
    (request, message) => dispatchContinuation(request, message, "follow-up"),
    [dispatchContinuation],
  );

  const resumeConversation = useCallback<CommentAiController["resume"]>(
    (request) => dispatchContinuation(request, t("comments.retry"), "resume"),
    [dispatchContinuation, t],
  );

  const retryConversation = useCallback<CommentAiController["retry"]>(
    async (request) => {
      const continuation = continuationRecordRef.current[request.operationId];
      if (
        (continuation?.status === "unavailable" && continuation.options) ||
        dispatchRecoveryRecord[request.operationId]
      ) {
        await start({
          threadId: request.threadId,
          rootCommentId: request.rootCommentId,
          submittedMode: request.submittedMode ?? request.intent ?? "auto",
          instructions: request.instructions ?? t("comments.retry"),
          ...(request.submittedProvider
            ? { provider: request.submittedProvider }
            : {}),
          ...(request.submittedModel ? { model: request.submittedModel } : {}),
          ...(request.submittedEngine
            ? { engine: request.submittedEngine }
            : {}),
          ...(request.continuationOfRequestId
            ? { continuationOfRequestId: request.continuationOfRequestId }
            : {}),
          requestId: request.requestId,
        });
        return;
      }
      await resumeConversation(request);
    },
    [dispatchRecoveryRecord, resumeConversation, start, t],
  );

  const stop = useCallback<CommentAiController["stop"]>(
    async (request) => {
      setStoppingRequestIds((current) =>
        new Set(current).add(request.operationId),
      );
      try {
        const continuation = continuations.get(request.operationId);
        const activeContinuation =
          continuation &&
          (continuation.status === "queued" ||
            continuation.status === "running");
        if (activeContinuation) {
          await cancelBackgroundAgentSession({
            threadId: continuation.threadId,
            turnId: continuation.turnId,
            reason: "user",
          });
          updateContinuation(request.operationId, {
            ...continuation,
            status: "aborted",
          });
          setTranscriptRevision((value) => value + 1);
          return;
        }
        const receipt = sessionReceipt(request);
        if (!receipt)
          throw new Error("This AI conversation is not available yet");
        await cancelBackgroundAgentSession({
          threadId: receipt.threadId,
          turnId: receipt.turnId,
          reason: "user",
        });
        await reconcile(request, receipt.threadId, receipt.turnId, "aborted");
      } catch (error) {
        const recovery = dispatchRecoveryRecord[request.operationId];
        if (recovery && ACTIVE_STATUSES.has(request.status)) {
          setDispatchRecoveryRecord((current) => ({
            ...current,
            [request.operationId]: {
              ...recovery,
              error:
                error instanceof Error
                  ? error.message
                  : t("comments.aiRequestStopCouldNotBeConfirmed"),
            },
          }));
        }
        throw error;
      } finally {
        setStoppingRequestIds((current) => {
          const next = new Set(current);
          next.delete(request.operationId);
          return next;
        });
      }
    },
    [
      continuations,
      dispatchRecoveryRecord,
      reconcile,
      setDispatchRecoveryRecord,
      updateContinuation,
    ],
  );

  const undo = useCallback<CommentAiController["undo"]>(async (request) => {
    await callAction("undo-comment-ai-request", {
      requestId: request.operationId,
    });
    await refetchRef.current();
  }, []);
  const { freshResolutions, dismissResolution } =
    useFreshAiResolutions(requests);

  const open = useCallback(
    (request: CommentAiRequest) => {
      if (!request.agentThreadId) return;
      requestAgentChatThreadOpen({
        threadId: request.agentThreadId,
        prefill: t("comments.aiConversationPrefill"),
      });
    },
    [t],
  );

  return useMemo(
    () => ({
      requests,
      startingThreadIds,
      stoppingRequestIds,
      continuations,
      transcriptRevision,
      start,
      continue: continueConversation,
      retry: retryConversation,
      resume: resumeConversation,
      stop,
      open,
      undo,
      freshResolutions,
      dismissResolution,
    }),
    [
      requests,
      startingThreadIds,
      stoppingRequestIds,
      continuations,
      transcriptRevision,
      start,
      continueConversation,
      retryConversation,
      resumeConversation,
      stop,
      open,
      undo,
      freshResolutions,
      dismissResolution,
    ],
  );
}

function requestStatusLabel(
  request: CommentAiRequest,
  t: ReturnType<typeof useT>,
) {
  if (request.status === "classifying" || request.status === "classified")
    return t("comments.aiWorking");
  if (request.status === "queued") return t("comments.aiQueued");
  if (request.status === "running") return t("comments.aiWorking");
  if (request.status === "refreshing") return t("comments.aiRefreshing");
  if (request.status === "failed") return t("comments.aiFailed");
  if (request.status === "cancelled") return t("comments.aiCancelled");
  if (request.status === "needs-review") return t("comments.aiNeedsReview");
  if (request.status === "suggested") return t("comments.aiSuggestionReady");
  if (request.status === "resolved")
    return request.result?.undone
      ? t("comments.aiChangeUndone")
      : t("comments.aiChangesApplied");
  return t("comments.aiReplied");
}

export function CommentAiRequestStatus({
  request,
  continuation,
  stopping = false,
  onRetry,
  onStop,
  onUndo,
  onDone,
}: {
  request: CommentAiRequest;
  continuation?: CommentAiContinuationState;
  stopping?: boolean;
  onRetry: () => Promise<void>;
  onStop: () => Promise<void>;
  onUndo?: () => Promise<void>;
  onDone?: () => void;
}) {
  const t = useT();
  if (
    !continuation &&
    isAppliedResolution(request) &&
    request.result?.changes?.length
  ) {
    return (
      <CommentAiAppliedChanges
        request={request}
        onUndo={onUndo}
        onDone={onDone}
      />
    );
  }
  const active =
    ACTIVE_STATUSES.has(request.status) ||
    continuation?.status === "queued" ||
    continuation?.status === "running";
  const failed =
    request.status === "failed" ||
    request.status === "needs-review" ||
    continuation?.status === "errored" ||
    continuation?.status === "truncated" ||
    continuation?.status === "unavailable";
  const continuationLabel = continuation
    ? continuation.status === "queued" || continuation.status === "running"
      ? t("comments.aiWorking")
      : continuation.status === "aborted"
        ? t("comments.aiCancelled")
        : continuation.status === "completed"
          ? t("comments.aiReplied")
          : t("comments.aiFailed")
    : null;
  const label = stopping
    ? t("comments.aiStopping")
    : (continuationLabel ?? requestStatusLabel(request, t));
  // A finished reply already reads as the agent's own row; only show status
  // while work is in flight, when it needs attention, or for non-reply results.
  if (!active && !failed && request.status === "replied" && !continuation)
    return null;
  return (
    <div
      className="flex min-h-7 min-w-0 items-center gap-2.5"
      data-comment-ai-status={continuation?.status ?? request.status}
    >
      <AgentAvatar model={request.model} className="size-7" />
      <div
        role={failed ? "alert" : "status"}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 text-sm",
          failed ? "text-destructive" : "text-muted-foreground",
        )}
        title={continuation?.error ?? request.error ?? undefined}
      >
        {active ? <Spinner aria-hidden className="size-3.5 shrink-0" /> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </div>
      {active ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={stopping}
          onClick={() => void onStop()}
        >
          {t("comments.aiStop")}
        </Button>
      ) : failed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void onRetry()}
        >
          {t("comments.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The result of Apply changes and resolve: what changed, with Undo, and Done
 * to put the resolved thread away.
 */
function CommentAiAppliedChanges({
  request,
  onUndo,
  onDone,
}: {
  request: CommentAiRequest;
  onUndo?: () => Promise<void>;
  onDone?: () => void;
}) {
  const t = useT();
  const [undoing, setUndoing] = useState(false);
  const changes = request.result?.changes ?? [];
  const first = changes[0];
  const segments = useMemo(
    () => (first ? trimDiffContext(wordDiff(first.before, first.after)) : []),
    [first],
  );
  const undoable = request.result?.undoable !== false;
  return (
    <div className="grid gap-2" data-comment-ai-applied>
      <div
        className="flex min-h-7 min-w-0 items-center gap-2.5"
        data-comment-ai-status={request.status}
      >
        <AgentAvatar model={request.model} className="size-7" />
        <div
          role="status"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground"
        >
          <IconCircleCheck size={15} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t("comments.aiAppliedAndResolved")}
          </span>
        </div>
      </div>
      <div className="ms-9.5 grid gap-2">
        <p
          className="break-words rounded-lg bg-muted/60 px-3 py-2 text-sm leading-6"
          data-comment-ai-change
        >
          {segments.map((segment, index) =>
            segment.kind === "removed" ? (
              <del
                key={index}
                className="text-muted-foreground decoration-muted-foreground/70"
              >
                {segment.text}
              </del>
            ) : segment.kind === "added" ? (
              <ins
                key={index}
                className="text-[hsl(var(--suggestion))] no-underline"
              >
                {segment.text}
              </ins>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
          {changes.length > 1 ? (
            <span className="block text-xs text-muted-foreground">
              {t("comments.aiMoreChanges", { count: changes.length - 1 })}
            </span>
          ) : null}
        </p>
        {onUndo || onDone ? (
          <div className="flex items-center gap-1">
            {onUndo ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!undoable || undoing}
                title={undoable ? undefined : t("comments.aiUndoUnavailable")}
                onClick={async () => {
                  setUndoing(true);
                  try {
                    await onUndo();
                  } finally {
                    setUndoing(false);
                  }
                }}
                data-comment-ai-undo
              >
                {undoing ? <Spinner aria-hidden className="size-3.5" /> : null}
                {t("comments.aiUndo")}
              </Button>
            ) : null}
            {onDone ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDone}
                data-comment-ai-done
              >
                {t("comments.aiDone")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CommentAiConversation({
  request,
  revision,
  continuation,
}: {
  request: CommentAiRequest;
  revision: number;
  continuation?: CommentAiContinuationState;
}) {
  const t = useT();
  const query = useQuery({
    queryKey: [
      "comment-ai-conversation",
      request.operationId,
      request.agentThreadId,
      revision,
    ],
    queryFn: ({ signal }) =>
      loadCommentAiConversation({
        operationId: request.operationId,
        agentThreadId: request.agentThreadId!,
        initialTurnId: request.agentTurnId!,
        signal,
      }),
    enabled: Boolean(request.agentThreadId && request.agentTurnId),
    refetchInterval:
      continuation?.status === "queued" || continuation?.status === "running"
        ? ACTIVE_REQUEST_REFETCH_INTERVAL_MS
        : false,
    retry: false,
  });
  if (query.isError) {
    return (
      <div role="alert" className="text-xs text-destructive">
        {t("comments.aiConversationUnavailable")}
      </div>
    );
  }
  if (!query.data?.length) return null;
  const modelLabel = modelDisplayName(request.model);
  return (
    <div className="grid gap-3.5" data-comment-ai-conversation>
      {query.data
        .filter((turn) => turn.assistantText)
        .map((turn) => (
          <CommentRow
            key={turn.turnId}
            avatar={<AgentAvatar model={request.model} />}
            name={
              <>
                <span className="sr-only">
                  {agentDisplayName(request.model)}:{" "}
                </span>
                <span aria-hidden>{agentDisplayName(request.model)}</span>
              </>
            }
            badge={
              <CommentAgentBadge
                ariaLabel={commentAiModelLabel(request.model)}
                details={<span className="font-medium">{modelLabel}</span>}
              />
            }
            footer={
              turn.status === "incomplete" ? (
                <div className="text-xs text-destructive">
                  {t("comments.aiFollowUpIncomplete")}
                </div>
              ) : null
            }
          >
            <InlineMarkdown content={turn.assistantText!} />
          </CommentRow>
        ))}
    </div>
  );
}

export { commentAiModelLabel };
