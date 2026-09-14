import {
  cancelBackgroundAgentSession,
  getBackgroundAgentSessionStatus,
  requestAgentChatThreadOpen,
  startBackgroundAgentSession,
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
const TERMINAL_SESSION_STATUSES = new Set<BackgroundAgentSessionStatus>([
  "completed",
  "truncated",
  "errored",
  "aborted",
  "unavailable",
]);
const ACTIVE_REQUEST_REFETCH_INTERVAL_MS = 1_500;

export interface CommentAiContinuationState {
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
  }): Promise<void>;
  continue(request: CommentAiRequest, message: string): Promise<void>;
  stop(request: CommentAiRequest): Promise<void>;
  open(request: CommentAiRequest): void;
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
  return {
    operationId: request.operationId,
    threadId: request.agentThreadId,
    turnId: request.operationId,
  };
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
      status: CommentAiSessionStatus,
      runId?: string,
      terminalReason?: string | null,
    ) => {
      await callAction("reconcile-comment-ai-session", {
        operationId: request.operationId,
        threadId: request.agentThreadId,
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
      if (
        !ACTIVE_STATUSES.has(request.status) ||
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
              snapshot = await getBackgroundAgentSessionStatus(
                sessionReceipt(request),
              );
              retryDelay = ACTIVE_REQUEST_REFETCH_INTERVAL_MS;
            } catch {
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
              retryDelay = Math.min(retryDelay * 2, 10_000);
              continue;
            }
            if (TERMINAL_SESSION_STATUSES.has(snapshot.status)) {
              await reconcile(
                request,
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
    async ({ threadId, rootCommentId, intent }) => {
      const active = requestsRef.current.some(
        (request) =>
          request.threadId === threadId && ACTIVE_STATUSES.has(request.status),
      );
      if (active || startingRef.current.has(threadId)) return;

      const requestId = globalThis.crypto.randomUUID();
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
            operationId: started.backgroundSession.operationId,
            threadId: started.backgroundSession.threadId,
            scope: started.backgroundSession.scope,
            instructions: started.context,
            usageLabel: "content:comment-ai",
          });
          await handle.accepted;
        }
        await query.refetch();
      } catch (error) {
        if (started) {
          await reconcile(
            started,
            "errored",
            undefined,
            error instanceof Error ? error.message : undefined,
          ).catch(() => {});
        }
        throw error;
      } finally {
        startingRef.current.delete(threadId);
        setStartingThreadIds(new Set(startingRef.current));
      }
    },
    [documentId, query, reconcile],
  );

  const monitorContinuation = useCallback(
    async (request: CommentAiRequest, turnId: string) => {
      if (monitoredContinuationsRef.current.has(turnId)) return;
      monitoredContinuationsRef.current.add(turnId);
      const receipt = {
        operationId: turnId,
        threadId: request.agentThreadId,
        turnId,
      };
      let retryDelay = ACTIVE_REQUEST_REFETCH_INTERVAL_MS;
      try {
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          if (!mountedRef.current) return;
          let snapshot;
          try {
            snapshot = await getBackgroundAgentSessionStatus(receipt);
            retryDelay = ACTIVE_REQUEST_REFETCH_INTERVAL_MS;
          } catch {
            retryDelay = Math.min(retryDelay * 2, 10_000);
            continue;
          }
          updateContinuation(request.operationId, {
            turnId,
            status: snapshot.status,
            ...(snapshot.terminalReason
              ? { error: snapshot.terminalReason }
              : {}),
          });
          if (TERMINAL_SESSION_STATUSES.has(snapshot.status)) {
            setTranscriptRevision((value) => value + 1);
            return;
          }
        }
      } finally {
        monitoredContinuationsRef.current.delete(turnId);
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
      if (request) void monitorContinuation(request, continuation.turnId);
    }
  }, [continuations, monitorContinuation, requests]);

  const continueConversation = useCallback<CommentAiController["continue"]>(
    async (request, message) => {
      const turnId = globalThis.crypto.randomUUID();
      updateContinuation(request.operationId, { turnId, status: "queued" });
      try {
        const handle = startBackgroundAgentSession({
          message,
          operationId: turnId,
          threadId: request.agentThreadId,
          scope: { type: "content-comment-ai", id: request.operationId },
          instructions:
            "Continue this comment AI conversation and answer the follow-up directly. Keep the original intent and action scope. Do not repeat a completed comment action or create a duplicate receipt.",
          ...(request.model ? { model: request.model } : {}),
          usageLabel: "content:comment-ai-follow-up",
        });
        await handle.accepted;
        updateContinuation(request.operationId, { turnId, status: "running" });
        void monitorContinuation(request, turnId);
      } catch (error) {
        updateContinuation(request.operationId, {
          turnId,
          status: "errored",
          error: error instanceof Error ? error.message : undefined,
        });
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
            threadId: request.agentThreadId,
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
        await cancelBackgroundAgentSession({
          threadId: request.agentThreadId,
          turnId: request.operationId,
          reason: "user",
        });
        await reconcile(request, "aborted");
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
  onStart: (intent: CommentAiIntent) => Promise<void>;
}) {
  const t = useT();
  const active =
    starting || Boolean(request && ACTIVE_STATUSES.has(request.status));
  const start = (intent: CommentAiIntent) => {
    if (!active) void onStart(intent);
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
        agentThreadId: request.agentThreadId,
        signal,
      }),
    enabled: Boolean(request.agentThreadId),
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
