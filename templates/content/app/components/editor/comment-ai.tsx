import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  CommentAiIntent,
  CommentAiRequest,
  StartCommentAiResult,
} from "@shared/comment-ai";
import { IconSparkles } from "@tabler/icons-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ACTIVE_STATUSES = new Set<CommentAiRequest["status"]>([
  "queued",
  "running",
]);
const ACTIVE_REQUEST_REFETCH_INTERVAL_MS = 2_000;

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
        (request.status === "queued" || request.status === "running"),
    )
    ? ACTIVE_REQUEST_REFETCH_INTERVAL_MS
    : false;
}

export interface CommentAiController {
  requests: CommentAiRequest[];
  startingThreadIds: ReadonlySet<string>;
  start(input: {
    threadId: string;
    rootCommentId: string;
    intent: CommentAiIntent;
    requestId?: string;
  }): Promise<void>;
}

export function latestCommentAiRequest(
  requests: readonly CommentAiRequest[],
  threadId: string,
): CommentAiRequest | undefined {
  return requests
    .filter((request) => request.threadId === threadId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function useCommentAiRequests(
  documentId: string,
  options: { enabled: boolean },
): CommentAiController {
  const t = useT();
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
  const startingRef = useRef(new Set<string>());
  const [startingThreadIds, setStartingThreadIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

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
      try {
        const started = await callAction<StartCommentAiResult>(
          "start-comment-ai-request",
          {
            documentId,
            threadId,
            rootCommentId,
            intent,
            requestId,
          },
        );
        const message = {
          message: t(
            intent === "suggest"
              ? "comments.aiPromptSuggest"
              : intent === "reply"
                ? "comments.aiPromptReply"
                : "comments.aiPromptApplyResolve",
          ),
          context: started.context,
          submit: true,
          openSidebar: true,
          actionScope: started.actionScope,
        };
        if (started.dispatch) sendToAgentChat(message);
        await query.refetch();
      } finally {
        startingRef.current.delete(threadId);
        setStartingThreadIds(new Set(startingRef.current));
      }
    },
    [documentId, query, t],
  );

  return useMemo(
    () => ({ requests, startingThreadIds, start }),
    [requests, start, startingThreadIds],
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
  const active = starting || (request && ACTIVE_STATUSES.has(request.status));
  const start = (intent: CommentAiIntent, requestId?: string) => {
    if (active) return;
    void onStart(intent, requestId);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={ariaLabel}
            className="size-7"
            onClick={(event) => event.stopPropagation()}
          >
            <IconSparkles size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          data-comment-ai-menu
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={Boolean(active) || !canSuggest}
              onSelect={() => start("suggest")}
            >
              <span>{t("comments.aiSuggestChanges")}</span>
              {!canSuggest ? (
                <span className="ms-auto text-xs text-muted-foreground">
                  {t("comments.aiUnavailable")}
                </span>
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={Boolean(active) || !canReply}
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
                  disabled={Boolean(active)}
                  onSelect={() => start("apply-resolve")}
                >
                  {t("comments.aiApplyAndResolve")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {request ? (
        <CommentAiRequestStatus
          request={request}
          starting={starting}
          onRetry={() => onStart(request.intent, request.requestId)}
        />
      ) : null}
    </>
  );
}

function CommentAiRequestStatus({
  request,
  starting,
  onRetry,
}: {
  request: CommentAiRequest;
  starting: boolean;
  onRetry: () => Promise<void>;
}) {
  const t = useT();
  if (request.status === "failed" || request.status === "needs-review") {
    const label =
      request.status === "failed"
        ? t("comments.aiFailed")
        : t("comments.aiNeedsReview");
    const suggestionId = request.result?.suggestionId;
    return (
      <span
        role={request.status === "failed" ? "alert" : "status"}
        className={
          request.status === "failed"
            ? "flex min-w-0 items-center gap-1.5 text-xs text-destructive"
            : "flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        }
        data-comment-ai-status={request.status}
        title={request.error ?? undefined}
      >
        {suggestionId ? (
          <Link
            className="truncate hover:text-foreground hover:underline"
            to={`?suggestion=${encodeURIComponent(suggestionId)}`}
            onClick={(event) => event.stopPropagation()}
          >
            {label}
          </Link>
        ) : (
          <span className="truncate">{label}</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={starting}
          className="h-6 shrink-0 px-1.5"
          onClick={(event) => {
            event.stopPropagation();
            void onRetry();
          }}
        >
          {t("comments.retry")}
        </Button>
      </span>
    );
  }

  const label =
    request.status === "queued" || request.status === "running"
      ? t("comments.aiWorking")
      : request.status === "replied"
        ? t("comments.aiReplied")
        : request.status === "suggested"
          ? t("comments.aiSuggestionReady")
          : request.status === "resolved"
            ? t("comments.aiChangesApplied")
            : t("comments.aiNeedsReview");
  const suggestionId = request.result?.suggestionId;
  return (
    <span
      role="status"
      className="text-xs text-muted-foreground"
      data-comment-ai-status={request.status}
    >
      {suggestionId ? (
        <Link
          className="hover:text-foreground hover:underline"
          to={`?suggestion=${encodeURIComponent(suggestionId)}`}
          onClick={(event) => event.stopPropagation()}
        >
          {label}
        </Link>
      ) : (
        label
      )}
    </span>
  );
}
