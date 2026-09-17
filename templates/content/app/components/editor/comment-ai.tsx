import {
  cancelBackgroundAgentSession,
  getBackgroundAgentSessionStatus,
  requestAgentChatThreadOpen,
  startBackgroundAgentSession,
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

export interface CommentAiContinuationState {
  operationId: string;
  threadId: string;
  turnId: string;
  status: BackgroundAgentSessionStatus;
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
  const requests = query.data?.requests ?? [];
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
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
  const [continuationRecord, setContinuationRecord] = useLocalStorage<
    Record<string, CommentAiContinuationState>
  >(`content-comment-ai-continuations:${documentId}`, {});
  const continuations = useMemo(
    () => new Map(Object.entries(continuationRecord)),
    [continuationRecord],
  );
  const updateContinuation = useCallback(
    (operationId: string, state: CommentAiContinuationState) => {
      setContinuationRecord((current) => ({
        ...current,
        [operationId]: state,
      }));
    },
    [setContinuationRecord],
  );
  const [transcriptRevision, setTranscriptRevision] = useState(0);
  const t = useT();

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
    for (const request of requests) {
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
            requestsRef.current.some(
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
  }, [reconcile, requests]);

  const start = useCallback<CommentAiController["start"]>(
    async ({ threadId, rootCommentId, intent, requestId: retryRequestId }) => {
      const active = requestsRef.current.some(
        (request) =>
          request.threadId === threadId && ACTIVE_STATUSES.has(request.status),
      );
      if (active || startingRef.current.has(threadId)) return;

      const requestId = retryRequestId ?? globalThis.crypto.randomUUID();
      startingRef.current.add(threadId);
      setStartingThreadIds(new Set(startingRef.current));
      let started: StartCommentAiResult | null = null;
      try {
        started = await callAction<StartCommentAiResult>(
          "start-comment-ai-request",
          { documentId, threadId, rootCommentId, intent, requestId },
        );
        if (started.dispatch) {
          const handle = startBackgroundAgentSession({
            message: started.prompt,
            instructions: started.context,
            ...started.backgroundSession,
            usageLabel: "content:comment-ai",
          });
          void handle.accepted.then(
            () => refetchRef.current(),
            () => refetchRef.current(),
          );
        }
        await query.refetch();
      } catch (error) {
        throw error;
      } finally {
        startingRef.current.delete(threadId);
        setStartingThreadIds(new Set(startingRef.current));
      }
    },
    [documentId, query],
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
      const request = requests.find(
        (candidate) => candidate.operationId === operationId,
      );
      if (request) void monitorContinuation(request, continuation);
    }
  }, [continuations, monitorContinuation, requests]);

  const continueConversation = useCallback<CommentAiController["continue"]>(
    async (request, message) => {
      if (!request.agentThreadId) {
        throw new Error("This AI conversation is not available yet");
      }
      const operationId = globalThis.crypto.randomUUID();
      let continuation: CommentAiContinuationState | null = null;
      try {
        const handle = startBackgroundAgentSession({
          message,
          operationId,
          threadId: request.agentThreadId,
          scope: { type: "content-comment-ai", id: request.operationId },
          actionScope: {
            kind: "content-comment-ai",
            requestId: request.operationId,
          },
          instructions:
            "Continue this comment AI conversation and answer the follow-up directly. Keep the original intent and action scope. Do not repeat a completed comment action or create a duplicate receipt.",
          ...(request.model ? { model: request.model } : {}),
          usageLabel: "content:comment-ai-follow-up",
        });
        continuation = {
          operationId: handle.operationId,
          threadId: handle.threadId,
          turnId: handle.turnId,
          status: "queued" as const,
        };
        updateContinuation(request.operationId, continuation);
        void monitorContinuation(request, continuation);
        await handle.accepted;
        setContinuationRecord((current) =>
          acknowledgeCommentAiContinuation(
            current,
            request.operationId,
            continuation!.turnId,
          ),
        );
      } catch (error) {
        if (continuation) {
          setContinuationRecord((current) => {
            const observed = current[request.operationId];
            if (
              !observed ||
              observed.turnId !== continuation!.turnId ||
              (observed.status !== "queued" && observed.status !== "running")
            )
              return current;
            return {
              ...current,
              [request.operationId]: {
                ...observed,
                error: error instanceof Error ? error.message : undefined,
              },
            };
          });
        }
        throw error;
      }
    },
    [monitorContinuation, setContinuationRecord, updateContinuation],
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
      } finally {
        setStoppingRequestIds((current) => {
          const next = new Set(current);
          next.delete(request.operationId);
          return next;
        });
      }
    },
    [continuations, reconcile, updateContinuation],
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
  const active =
    starting || Boolean(request && ACTIVE_STATUSES.has(request.status));
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
  const canContinue =
    request.status === "replied" ||
    request.status === "suggested" ||
    request.status === "resolved" ||
    continuation?.status === "completed";
  const canRetry = !request.result?.editApplied && request.status === "failed";
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
