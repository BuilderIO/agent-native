import {
  cancelBackgroundAgentSession,
  isAgentChatAiSetupRequiredError,
  requestAgentChatThreadOpen,
  startBackgroundAgentSession,
} from "@agent-native/core/client/agent-chat";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type { ReviewMention } from "@agent-native/core/review";
import {
  firstAgentMention,
  useReviewAgentMentions,
  type ReviewMentionOption,
} from "@agent-native/toolkit/app/review";
import {
  isSlideReviewAgentActive,
  type SlideReviewAgentRequest,
  type SlideReviewAgentSession,
} from "@shared/slide-review-agent";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ACTIVE_POLL_INTERVAL_MS = 1_500;
const NO_REQUESTS: readonly SlideReviewAgentRequest[] = [];

export type SlideReviewAgentStartOutcome =
  | "started"
  | "busy"
  | "setup-required"
  | "failed";

export interface SlideReviewAgentController {
  /** Agent `@` options; empty for anyone who cannot ask the agent. */
  mentionOptions: readonly ReviewMentionOption[];
  requestForThread: (threadId: string) => SlideReviewAgentRequest | undefined;
  isStarting: (threadId: string) => boolean;
  isStopping: (requestId: string) => boolean;
  /** Starts a run when `mentions` tag an agent; a no-op otherwise. */
  startIfTagged: (input: {
    threadId: string;
    commentId: string;
    mentions: readonly ReviewMention[];
  }) => Promise<SlideReviewAgentStartOutcome | null>;
  stop: (request: SlideReviewAgentRequest) => Promise<void>;
  open: (request: SlideReviewAgentRequest) => void;
}

interface ListResult {
  requests: SlideReviewAgentRequest[];
}

interface StartResult {
  request: SlideReviewAgentRequest;
  started: boolean;
}

interface CancelResult {
  request: SlideReviewAgentRequest;
  receipt: { threadId: string; turnId: string } | null;
  changed: boolean;
}

function dispatch(session: SlideReviewAgentSession) {
  return startBackgroundAgentSession({
    message: session.message,
    instructions: session.instructions,
    operationId: session.operationId,
    threadId: session.threadId,
    scope: session.scope,
    actionScope: session.actionScope,
    ...(session.model ? { model: session.model } : {}),
    ...(session.engine ? { engine: session.engine } : {}),
    usageLabel: session.usageLabel,
  });
}

function errorCode(error: unknown): string | null {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === "string" ? code : null;
}

/**
 * Agent requests on one deck's review threads: the `@agent` options, status
 * for each thread, and start/stop. Only editors can ask the agent; everyone
 * who can view the deck sees what it is doing.
 */
export function useSlideReviewAgent({
  deckId,
  canAsk,
}: {
  deckId: string | null;
  canAsk: boolean;
}): SlideReviewAgentController {
  const queryClient = useQueryClient();
  const { mentionOptions, resolveMention } = useReviewAgentMentions({
    scope: "slides-review-agent",
    enabled: canAsk && Boolean(deckId),
  });
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const dispatched = useRef(new Set<string>());

  const listQuery = useActionQuery<ListResult>(
    "list-review-agent-requests",
    { deckId: deckId ?? "" },
    {
      enabled: Boolean(deckId),
      refetchInterval: (query) =>
        query.state.data?.requests.some((request) =>
          isSlideReviewAgentActive(request.status),
        )
          ? ACTIVE_POLL_INTERVAL_MS
          : false,
    },
  );
  const requests = listQuery.data?.requests ?? NO_REQUESTS;
  const { refetch } = listQuery;

  // A finished run posted its reply as a comment the open query has not seen.
  const lastActive = useRef(new Set<string>());
  useEffect(() => {
    const active = new Set(
      requests
        .filter((request) => isSlideReviewAgentActive(request.status))
        .map((request) => request.requestId),
    );
    const finished = [...lastActive.current].some((id) => !active.has(id));
    lastActive.current = active;
    if (finished) {
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-review-comments"],
      });
    }
  }, [queryClient, requests]);

  // A request whose dispatch never landed, such as after a reload, carries its
  // session; core makes a second dispatch of the same turn a no-op.
  useEffect(() => {
    for (const request of requests) {
      if (!request.session || dispatched.current.has(request.requestId)) {
        continue;
      }
      dispatched.current.add(request.requestId);
      void dispatch(request.session)
        .accepted.catch((error: unknown) =>
          callAction<CancelResult>("cancel-review-agent-request", {
            requestId: request.requestId,
            failure: isAgentChatAiSetupRequiredError(error)
              ? "engine_not_configured"
              : "dispatch_failed",
          }),
        )
        .catch((error: unknown) => {
          console.error(
            "[slides] could not record a failed agent dispatch:",
            error,
          );
        })
        .finally(() => void refetch());
    }
  }, [refetch, requests]);

  const byThread = useMemo(() => {
    const map = new Map<string, SlideReviewAgentRequest>();
    for (const request of requests) {
      const kept = map.get(request.threadId);
      if (!kept || kept.updatedAt < request.updatedAt) {
        map.set(request.threadId, request);
      }
    }
    return map;
  }, [requests]);

  const startIfTagged = useCallback<
    SlideReviewAgentController["startIfTagged"]
  >(
    async ({ threadId, commentId, mentions }) => {
      const chip = firstAgentMention(mentions);
      if (!canAsk || !deckId || !chip) return null;
      // The chip names a model that has since been disconnected.
      const selection = resolveMention(chip);
      if (!selection) return "setup-required";
      setStarting((current) => new Set(current).add(threadId));
      let requestId: string | null = null;
      try {
        const result = await callAction<StartResult>(
          "start-review-agent-request",
          {
            requestId: crypto.randomUUID(),
            deckId,
            threadId,
            triggerCommentId: commentId,
            engine: selection.engine,
            model: selection.model,
          },
        );
        requestId = result.request.requestId;
        const session = result.request.session;
        if (session) {
          dispatched.current.add(requestId);
          await dispatch(session).accepted;
        }
        return "started";
      } catch (error) {
        const setupRequired = isAgentChatAiSetupRequiredError(error);
        if (requestId) {
          // The row exists but no run will ever finish it.
          await callAction<CancelResult>("cancel-review-agent-request", {
            requestId,
            failure: setupRequired
              ? "engine_not_configured"
              : "dispatch_failed",
          }).catch((cancelError: unknown) => {
            console.error(
              "[slides] could not record a failed agent dispatch:",
              cancelError,
            );
          });
        }
        if (setupRequired) return "setup-required";
        return errorCode(error) === "busy" ? "busy" : "failed";
      } finally {
        setStarting((current) => {
          const next = new Set(current);
          next.delete(threadId);
          return next;
        });
        void refetch();
      }
    },
    [canAsk, deckId, refetch, resolveMention],
  );

  const stop = useCallback(
    async (request: SlideReviewAgentRequest) => {
      setStopping((current) => new Set(current).add(request.requestId));
      try {
        const result = await callAction<CancelResult>(
          "cancel-review-agent-request",
          { requestId: request.requestId },
        );
        if (result.receipt) {
          await cancelBackgroundAgentSession({
            ...result.receipt,
            reason: "review-agent-stopped",
          });
        }
      } finally {
        setStopping((current) => {
          const next = new Set(current);
          next.delete(request.requestId);
          return next;
        });
        void refetch();
      }
    },
    [refetch],
  );

  const open = useCallback((request: SlideReviewAgentRequest) => {
    if (!request.agentThreadId) return;
    requestAgentChatThreadOpen({ threadId: request.agentThreadId });
  }, []);

  return {
    mentionOptions,
    requestForThread: (threadId) => byThread.get(threadId),
    isStarting: (threadId) => starting.has(threadId),
    isStopping: (requestId) => stopping.has(requestId),
    startIfTagged,
    stop,
    open,
  };
}
