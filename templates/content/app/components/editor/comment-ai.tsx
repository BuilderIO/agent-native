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
import {
  IconExternalLink,
  IconMessageCircle,
  IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { loadCommentAiConversation } from "@/lib/comment-ai-client";

import { AgentAvatar, agentDisplayName } from "./agent-identity";

const ACTIVE_STATUSES = new Set<CommentAiRequest["status"]>([
  "queued",
  "running",
  "refreshing",
]);
const ACTIVE_REQUEST_REFETCH_INTERVAL_MS = 1_500;
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
  error?: string;
}

type PresentedCommentAiRequest = CommentAiRequest & {
  transportUnknown?: boolean;
};

export interface CommentAiController {
  requests: CommentAiRequest[];
  startingThreadIds: ReadonlySet<string>;
  stoppingRequestIds: ReadonlySet<string>;
  continuations: ReadonlyMap<string, CommentAiContinuationState>;
  transcriptRevision: number;
  start(input: {
    threadId: string;
    rootCommentId: string;
    intent: CommentAiIntent;
    requestId?: string;
  }): Promise<void>;
  continue(request: CommentAiRequest, message: string): Promise<void>;
  stop(request: CommentAiRequest): Promise<void>;
  open(request: CommentAiRequest): void;
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
  // authorization catches up. Absence alone must never manufacture failure.
  return snapshot.status !== "unavailable";
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
    async (requestId: string, options: BackgroundAgentSessionStartOptions) => {
      setDispatchRecoveryRecord((current) => ({
        ...current,
        [requestId]: { options },
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
        const snapshot = await handle.status().catch(() => null);
        if (snapshot && snapshot.status !== "unavailable") {
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
            error:
              error instanceof Error
                ? error.message
                : t("comments.aiRequestCouldNotBeConfirmed"),
          },
        }));
      }
    },
    [setDispatchRecoveryRecord],
  );

  const reconcile = useCallback(
    async (
      request: CommentAiRequest,
      turnId: string,
      status: CommentAiSessionStatus,
      runId?: string,
      terminalReason?: string | null,
    ) => {
      if (!request.agentThreadId) {
        throw new Error("This AI conversation is not available yet");
      }
      await callAction("reconcile-comment-ai-session", {
        operationId: request.operationId,
        threadId: request.agentThreadId,
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

  const start = useCallback<CommentAiController["start"]>(
    async ({ threadId, rootCommentId, intent, requestId: retryRequestId }) => {
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
        (active && !recovery && !continuationRecovery?.error) ||
        startingRef.current.has(threadId)
      )
        return;

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
          return;
        }
        if (recovery) {
          await dispatch(requestId, recovery.options);
          return;
        }
        started = await callAction<StartCommentAiResult>(
          "start-comment-ai-request",
          { documentId, threadId, rootCommentId, intent, requestId },
        );
        if (started.dispatch) {
          const options = {
            message: started.prompt,
            instructions: started.context,
            ...started.backgroundSession,
            usageLabel: "content:comment-ai",
          } satisfies BackgroundAgentSessionStartOptions;
          void dispatch(requestId, options);
        }
        await query.refetch();
      } catch (error) {
        throw error;
      } finally {
        startingRef.current.delete(threadId);
        setStartingThreadIds(new Set(startingRef.current));
      }
    },
    [dispatch, dispatchRecoveryRecord, documentId, query, updateContinuation],
  );

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

  const continueConversation = useCallback<CommentAiController["continue"]>(
    async (request, message) => {
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
            "Continue this comment AI conversation and answer the follow-up directly. Keep the original intent and action scope. Do not repeat a completed comment action or create a duplicate receipt." +
            (priorConversation
              ? `\n\nProtected conversation context:\n\n${priorConversation}`
              : ""),
          ...(request.model ? { model: request.model } : {}),
          usageLabel: "content:comment-ai-follow-up",
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
        await reconcile(request, receipt.turnId, "aborted");
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
      stop,
      open,
    }),
    [
      requests,
      startingThreadIds,
      stoppingRequestIds,
      continuations,
      transcriptRevision,
      start,
      continueConversation,
      stop,
      open,
    ],
  );
}

export function CommentAiThreadActions({
  "aria-label": ariaLabel,
  request,
  starting,
  canSuggest,
  canReply,
  canApply,
  onStart,
}: {
  "aria-label": string;
  request?: CommentAiRequest;
  starting: boolean;
  canSuggest: boolean;
  canReply: boolean;
  canApply: boolean;
  onStart: (intent: CommentAiIntent, requestId?: string) => Promise<void>;
}) {
  const t = useT();
  const transportUnknown = Boolean(
    (request as PresentedCommentAiRequest | undefined)?.transportUnknown,
  );
  const active =
    starting ||
    transportUnknown ||
    Boolean(request && ACTIVE_STATUSES.has(request.status));
  const start = (intent: CommentAiIntent, requestId?: string) => {
    if (!active) void onStart(intent, requestId);
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={ariaLabel}
              aria-busy={active}
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-10"
              onClick={(event) => event.stopPropagation()}
            >
              {active ? (
                <Spinner aria-hidden className="size-3.5" />
              ) : (
                <IconMessageCircle size={14} />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{ariaLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        data-comment-ai-menu
        data-comment-menu
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={active || !canSuggest}
            onSelect={() => start("suggest")}
          >
            {t("comments.aiSuggestChanges")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={active || !canReply}
            onSelect={() => start("reply")}
          >
            {t("comments.aiReplyInThread")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {canApply ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={active}
                onSelect={() => start("apply-resolve")}
              >
                {t("comments.aiApplyAndResolve")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function requestStatusLabel(
  request: CommentAiRequest,
  t: ReturnType<typeof useT>,
) {
  if (request.status === "queued") return t("comments.aiQueued");
  if (request.status === "running") return t("comments.aiWorking");
  if (request.status === "refreshing") return t("comments.aiRefreshing");
  if (request.status === "failed") return t("comments.aiFailed");
  if (request.status === "cancelled") return t("comments.aiCancelled");
  if (request.status === "needs-review") return t("comments.aiNeedsReview");
  if (request.status === "suggested") return t("comments.aiSuggestionReady");
  if (request.status === "resolved") return t("comments.aiChangesApplied");
  return t("comments.aiReplied");
}

export function CommentAiRequestStatus({
  request,
  continuation,
  stopping = false,
  onRetry,
  onReply,
  onStop,
  onOpen,
}: {
  request: CommentAiRequest;
  continuation?: CommentAiContinuationState;
  stopping?: boolean;
  onRetry: () => Promise<void>;
  onReply: () => void;
  onStop: () => Promise<void>;
  onOpen: () => void;
}) {
  const t = useT();
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
  const canContinue = continuation
    ? continuation.status === "completed"
    : request.status === "replied" ||
      request.status === "suggested" ||
      request.status === "resolved";
  const canRetry = failed;
  return (
    <div
      className="grid gap-1.5 border-t border-border px-3 py-2"
      data-comment-ai-status={continuation?.status ?? request.status}
    >
      <div
        role={failed ? "alert" : "status"}
        className={
          failed
            ? "flex min-w-0 items-center gap-1.5 text-xs text-destructive"
            : "flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        }
        title={continuation?.error ?? request.error ?? undefined}
      >
        {active ? <Spinner aria-hidden className="size-3.5 shrink-0" /> : null}
        <span className="min-w-0 flex-1 truncate">
          {stopping
            ? t("comments.aiStopping")
            : (continuationLabel ?? requestStatusLabel(request, t))}
        </span>
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            disabled={stopping}
            onClick={() => void onStop()}
          >
            {t("comments.aiStop")}
          </Button>
        ) : null}
      </div>
      {!active ? (
        <div className="flex flex-wrap items-center gap-1">
          {canRetry ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => void onRetry()}
            >
              {t("comments.retry")}
            </Button>
          ) : null}
          {canContinue ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={onReply}
            >
              {t("comments.aiReplyToAi")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2"
            onClick={onOpen}
          >
            <IconExternalLink size={13} />
            {t("comments.aiOpenConversation")}
          </Button>
        </div>
      ) : null}
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
      <div
        role="alert"
        className="border-t border-border px-3 py-2 text-xs text-destructive"
      >
        {t("comments.aiConversationUnavailable")}
      </div>
    );
  }
  if (!query.data?.length) return null;
  return (
    <div
      className="grid gap-2 border-t border-border px-3 py-2"
      data-comment-ai-conversation
    >
      {query.data.map((turn) => (
        <div key={turn.turnId} className="grid gap-1.5">
          {turn.userText ? (
            <div className="ml-8 rounded-md bg-muted px-2.5 py-2 text-[13px] leading-relaxed">
              <span className="sr-only">{t("comments.aiFollowUpYou")}: </span>
              <InlineMarkdown content={turn.userText} inline />
            </div>
          ) : null}
          {turn.assistantText ? (
            <div className="flex items-start gap-2 text-[13px] leading-relaxed">
              <AgentAvatar model={request.model} />
              <div className="min-w-0 flex-1">
                <span className="sr-only">
                  {agentDisplayName(request.model)}:{" "}
                </span>
                <InlineMarkdown content={turn.assistantText} />
                {turn.status === "incomplete" ? (
                  <div className="mt-1 text-xs text-destructive">
                    {t("comments.aiFollowUpIncomplete")}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function CommentAiReplyTarget({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  return (
    <div
      className="flex items-center justify-between gap-2 px-3 pt-2 text-xs text-muted-foreground"
      data-comment-ai-reply-target
    >
      <span>{t("comments.aiReplyingToAi")}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={t("comments.cancel")}
        onClick={onCancel}
      >
        <IconX size={13} />
      </Button>
    </div>
  );
}
