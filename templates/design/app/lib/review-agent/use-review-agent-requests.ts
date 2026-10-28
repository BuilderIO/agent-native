import {
  cancelBackgroundAgentSession,
  chatModelSelectionStorageKey,
  getBackgroundAgentSessionStatus,
  isAgentChatAiSetupRequiredError,
  requestAgentChatThreadOpen,
  requireAgentEngineConfiguredForDispatch,
  startBackgroundAgentSession,
  useChatModels,
  type BackgroundAgentSessionReceipt,
  type BackgroundAgentSessionSnapshot,
  type BackgroundAgentSessionStartOptions,
} from "@agent-native/core/client/agent-chat";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ReviewMention } from "@agent-native/core/review";
import type { ReviewMentionOption } from "@agent-native/toolkit/app/review";
import {
  isReviewAgentActive,
  REVIEW_AGENT_ACTIONS,
  type ReviewAgentErrorCode,
  type ReviewAgentMode,
  type ReviewAgentPendingSession,
  type ReviewAgentRequest,
  type StartReviewAgentResult,
} from "@shared/review-agent";
import { modelDisplayName } from "@shared/review-agent-identity";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  reviewAgentMentionOption,
  reviewAgentSelections,
  resolveReviewAgentMention,
  type ReviewAgentSelection,
} from "./review-agent-models";
import {
  isReviewAgentRequestLive,
  latestReviewAgentRequest,
  reviewAgentChatThreadId,
} from "./review-agent-status";

const ACTIVE_POLL_INTERVAL_MS = 1_500;
const MAX_STATUS_RETRY_DELAY_MS = 10_000;
const NO_REQUESTS: readonly ReviewAgentRequest[] = [];

export interface StartReviewAgentInput {
  threadId: string;
  /** `auto` for an `@agent` chip, else the menu item's intent. */
  mode: ReviewAgentMode;
  /** The requester's own comment holding the chip; required for `auto`. */
  triggerCommentId?: string | undefined;
  /** The chip's model; menu items use the stored or default one. */
  selection?: ReviewAgentSelection | null | undefined;
}

/**
 * `started`: the run is dispatched. `busy`: the thread already has a run.
 * `setup-required`: no AI model is connected, so nothing was created.
 * `unavailable`: it failed, and the person was told.
 */
export type ReviewAgentStartOutcome =
  | "started"
  | "busy"
  | "setup-required"
  | "unavailable";

export interface ReviewAgentController {
  /** False for anyone who cannot edit the design, and for signed-out viewers. */
  enabled: boolean;
  requests: readonly ReviewAgentRequest[];
  /** The latest request for the thread, by last update. */
  requestForThread(threadId: string): ReviewAgentRequest | undefined;
  /** A run is active on the thread (anyone's), or this tab is starting one. */
  isThreadBusy(threadId: string): boolean;
  startingThreadIds: ReadonlySet<string>;
  /** The model name to show while a start is in flight, when the caller chose one. */
  startingAgentName(threadId: string): string | null;
  stoppingRequestIds: ReadonlySet<string>;
  start(input: StartReviewAgentInput): Promise<ReviewAgentStartOutcome>;
  stop(request: ReviewAgentRequest): Promise<void>;
  retry(request: ReviewAgentRequest): Promise<ReviewAgentStartOutcome>;
  open(request: ReviewAgentRequest): void;
  models: {
    ready: boolean;
    options: readonly ReviewAgentSelection[];
    selected: ReviewAgentSelection | null;
  };
  /** The picker's Agents section; empty until a model is connected. */
  mentionOptions: readonly ReviewMentionOption[];
  /** The live selection a stored chip names, or null once that model is gone. */
  resolveMention(mention: ReviewMention): ReviewAgentSelection | null;
  /** A comment surface opened; loads the model list once and keeps it. */
  markSurfaceUsed(): void;
}

interface ListReviewAgentRequestsResult {
  requests: ReviewAgentRequest[];
}

interface CancelReviewAgentRequestResult {
  request: ReviewAgentRequest;
  receipt: { threadId: string; turnId: string } | null;
  changed: boolean;
}

type TerminalRunStatus = "completed" | "truncated" | "errored" | "aborted";

interface ReconcileReviewAgentSessionParams {
  requestId: string;
  phase: ReviewAgentPendingSession["phase"];
  status: TerminalRunStatus;
  runId?: string;
  terminalReason?: string;
  errorCode?: Extract<
    ReviewAgentErrorCode,
    "engine_not_configured" | "dispatch_failed"
  >;
}

interface StartReviewAgentParams {
  requestId: string;
  designId: string;
  threadId: string;
  mode: ReviewAgentMode;
  triggerCommentId?: string;
  provider?: string;
  model?: string;
  engine?: string;
}

const startRequest = (params: StartReviewAgentParams) =>
  callAction<StartReviewAgentResult>(REVIEW_AGENT_ACTIONS.start, params);

const cancelRequest = (requestId: string) =>
  callAction<CancelReviewAgentRequestResult>(REVIEW_AGENT_ACTIONS.cancel, {
    requestId,
  });

const reconcileSession = (params: ReconcileReviewAgentSessionParams) =>
  callAction<{ request: ReviewAgentRequest }>(
    REVIEW_AGENT_ACTIONS.reconcile,
    params,
  );

/** Poll only while a run could still be working; a run stuck past the stale window is the server's to expire. */
export function reviewAgentRefetchInterval(
  data: ListReviewAgentRequestsResult | undefined,
  now: number = Date.now(),
): number | false {
  return data?.requests.some((request) =>
    isReviewAgentRequestLive(request, now),
  )
    ? ACTIVE_POLL_INTERVAL_MS
    : false;
}

function isTerminalRunStatus(
  status: BackgroundAgentSessionSnapshot["status"],
): status is TerminalRunStatus {
  return (
    status === "completed" ||
    status === "truncated" ||
    status === "errored" ||
    status === "aborted"
  );
}

function sessionStartOptions(
  session: ReviewAgentPendingSession,
): BackgroundAgentSessionStartOptions {
  return {
    message: session.message,
    instructions: session.instructions,
    operationId: session.operationId,
    threadId: session.threadId,
    scope: session.scope,
    actionScope: session.actionScope,
    ...(session.model ? { model: session.model } : {}),
    ...(session.engine ? { engine: session.engine } : {}),
    usageLabel: session.usageLabel,
  };
}

interface MonitorTarget {
  requestId: string;
  phase: ReviewAgentPendingSession["phase"];
  receipt: BackgroundAgentSessionReceipt;
}

/** The run to watch for a request this person started: the dispatch pending, else the execution run. */
function monitorTargetFor(
  request: ReviewAgentRequest | undefined,
): MonitorTarget | null {
  if (
    !request ||
    !request.requesterIsMe ||
    !isReviewAgentActive(request.status)
  ) {
    return null;
  }
  const session = request.pendingSession;
  if (session) {
    return {
      requestId: request.requestId,
      phase: session.phase,
      receipt: {
        operationId: session.operationId,
        threadId: session.threadId,
        turnId: session.turnId,
      },
    };
  }
  if (request.agentThreadId && request.agentTurnId) {
    return {
      requestId: request.requestId,
      phase: "execution",
      receipt: {
        operationId: request.requestId,
        threadId: request.agentThreadId,
        turnId: request.agentTurnId,
      },
    };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

type DispatchOutcome = "accepted" | "setup-required" | "failed";

export function useReviewAgentRequests({
  designId,
  enabled,
  surfaceActive,
}: {
  designId: string | undefined;
  enabled: boolean;
  /** The comment tool or a thread card is open; the model list loads only then. */
  surfaceActive: boolean;
}): ReviewAgentController {
  const t = useT();
  const queryClient = useQueryClient();
  const active = enabled && Boolean(designId);

  const query = useActionQuery<ListReviewAgentRequestsResult>(
    REVIEW_AGENT_ACTIONS.list,
    { designId: designId ?? "" },
    {
      enabled: active,
      refetchInterval: (state) => reviewAgentRefetchInterval(state.state.data),
    },
  );
  const requests = query.data?.requests ?? NO_REQUESTS;
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  const refetch = useCallback(async () => {
    const result = await refetchRef.current();
    return result.data?.requests;
  }, []);
  const tRef = useRef(t);
  tRef.current = t;
  const activeRef = useRef(active);
  activeRef.current = active;
  const designIdRef = useRef(designId);
  designIdRef.current = designId;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [surfaceUsed, setSurfaceUsed] = useState(false);
  useEffect(() => {
    if (surfaceActive) setSurfaceUsed(true);
  }, [surfaceActive]);
  const markSurfaceUsed = useCallback(() => setSurfaceUsed(true), []);

  const chatModels = useChatModels({
    enabled: active && (surfaceUsed || surfaceActive),
    storageKey: chatModelSelectionStorageKey("design-review-agent"),
    unavailableSelectionPolicy: "require-explicit",
  });
  const { availableModels, selectedModel, selectedEngine, selectionReady } =
    chatModels;
  const options = useMemo(
    () =>
      reviewAgentSelections(
        availableModels.filter((group) => group.configured),
        { model: selectedModel, engine: selectedEngine },
      ),
    [availableModels, selectedEngine, selectedModel],
  );
  const selected = useMemo(
    () =>
      selectionReady
        ? (options.find(
            (option) =>
              option.model === selectedModel &&
              option.engine === selectedEngine,
          ) ?? null)
        : null,
    [options, selectedEngine, selectedModel, selectionReady],
  );
  const ready = active && selectionReady && options.length > 0;
  const mentionOptions = useMemo<readonly ReviewMentionOption[]>(
    () => (ready ? options.map(reviewAgentMentionOption) : []),
    [options, ready],
  );
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const resolveMention = useCallback(
    (mention: ReviewMention) =>
      resolveReviewAgentMention(optionsRef.current, mention),
    [],
  );

  const startingRef = useRef(new Map<string, string | null>());
  const [startingNames, setStartingNames] = useState<
    ReadonlyMap<string, string | null>
  >(() => new Map());
  const startingThreadIds = useMemo<ReadonlySet<string>>(
    () => new Set(startingNames.keys()),
    [startingNames],
  );
  const [stoppingRequestIds, setStoppingRequestIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const dispatchedRef = useRef(new Set<string>());
  const previousStatusesRef = useRef(
    new Map<string, ReviewAgentRequest["status"]>(),
  );

  const syncStarting = useCallback(() => {
    if (mountedRef.current) setStartingNames(new Map(startingRef.current));
  }, []);

  const reconcileFailure = useCallback(
    async (
      requestId: string,
      phase: ReviewAgentPendingSession["phase"],
      errorCode: "engine_not_configured" | "dispatch_failed",
    ) => {
      try {
        await reconcileSession({
          requestId,
          phase,
          status: "errored",
          errorCode,
        });
      } catch (error) {
        // The row stays active; the stale expiry or the next mount's resume finishes it.
        console.warn(
          "[design] could not record a failed agent dispatch",
          error,
        );
      }
    },
    [],
  );

  const dispatchSession = useCallback(
    async (
      requestId: string,
      session: ReviewAgentPendingSession,
    ): Promise<DispatchOutcome> => {
      dispatchedRef.current.add(`${requestId}:${session.phase}`);
      let failure: unknown;
      try {
        const handle = startBackgroundAgentSession(
          sessionStartOptions(session),
        );
        try {
          await handle.accepted;
          return "accepted";
        } catch (error) {
          failure = error;
          // A durable turn that already exists means core admitted it earlier.
          const snapshot = await handle.status();
          if (snapshot.status !== "unavailable") return "accepted";
        }
      } catch (error) {
        failure ??= error;
      }
      const setupRequired = isAgentChatAiSetupRequiredError(failure);
      await reconcileFailure(
        requestId,
        session.phase,
        setupRequired ? "engine_not_configured" : "dispatch_failed",
      );
      return setupRequired ? "setup-required" : "failed";
    },
    [reconcileFailure],
  );

  const start = useCallback(
    async (input: StartReviewAgentInput): Promise<ReviewAgentStartOutcome> => {
      const { threadId } = input;
      const currentDesignId = designIdRef.current;
      if (!activeRef.current || !currentDesignId) {
        toast.error(tRef.current("review.agent.startFailed"));
        return "unavailable";
      }
      const now = Date.now();
      if (
        startingRef.current.has(threadId) ||
        requestsRef.current.some(
          (request) =>
            request.threadId === threadId &&
            isReviewAgentRequestLive(request, now),
        )
      ) {
        toast.info(tRef.current("review.agent.busy"));
        return "busy";
      }
      const { selection } = input;
      startingRef.current.set(
        threadId,
        selection ? modelDisplayName(selection.model) : null,
      );
      syncStarting();
      try {
        try {
          await requireAgentEngineConfiguredForDispatch(
            selection ? { engine: selection.engine } : {},
          );
        } catch (error) {
          if (isAgentChatAiSetupRequiredError(error)) {
            toast.error(tRef.current("review.agent.setupRequired"));
            return "setup-required";
          }
          throw error;
        }
        const result = await startRequest({
          requestId: globalThis.crypto.randomUUID(),
          designId: currentDesignId,
          threadId,
          mode: input.mode,
          ...(input.triggerCommentId
            ? { triggerCommentId: input.triggerCommentId }
            : {}),
          ...(selection
            ? {
                provider: selection.provider,
                model: selection.model,
                engine: selection.engine,
              }
            : {}),
        });
        if (result.outcome === "busy") {
          await refetch();
          toast.info(tRef.current("review.agent.busy"));
          return "busy";
        }
        // Seed the row as active so its first terminal sighting refreshes the thread.
        previousStatusesRef.current.set(result.request.requestId, "queued");
        if (result.dispatch) {
          const session = result.pendingSession;
          if (!session) {
            throw new Error(
              "start-review-agent-request asked for a dispatch without a session",
            );
          }
          if (
            !dispatchedRef.current.has(
              `${result.request.requestId}:${session.phase}`,
            )
          ) {
            const outcome = await dispatchSession(
              result.request.requestId,
              session,
            );
            if (outcome !== "accepted") {
              toast.error(
                tRef.current(
                  outcome === "setup-required"
                    ? "review.agent.setupRequired"
                    : "review.agent.startFailed",
                ),
              );
              await refetch();
              return "unavailable";
            }
          }
        }
        await refetch();
        return "started";
      } catch (error) {
        console.warn("[design] could not start the review agent", error);
        toast.error(tRef.current("review.agent.startFailed"));
        return "unavailable";
      } finally {
        startingRef.current.delete(threadId);
        syncStarting();
      }
    },
    [dispatchSession, refetch, syncStarting],
  );

  const stop = useCallback(
    async (request: ReviewAgentRequest) => {
      setStoppingRequestIds((current) =>
        new Set(current).add(request.requestId),
      );
      try {
        // The row is cancelled first so the run's next action is refused even if the abort is slow.
        const result = await cancelRequest(request.requestId);
        if (result.receipt) {
          try {
            await cancelBackgroundAgentSession({
              ...result.receipt,
              reason: "user",
            });
          } catch (error) {
            // No run to abort yet (its dispatch never landed) is fine; the row is already cancelled.
            if (httpStatusOf(error) !== 404) {
              toast.error(tRef.current("review.agent.cancelFailed"));
            }
          }
        }
        await refetch();
      } catch (error) {
        console.warn("[design] could not stop the review agent", error);
        toast.error(tRef.current("review.agent.cancelFailed"));
      } finally {
        if (mountedRef.current) {
          setStoppingRequestIds((current) => {
            const next = new Set(current);
            next.delete(request.requestId);
            return next;
          });
        }
      }
    },
    [refetch],
  );

  const retry = useCallback(
    (request: ReviewAgentRequest) => {
      const submitted = request.submitted;
      return start({
        threadId: request.threadId,
        mode: request.mode,
        triggerCommentId: request.triggerCommentId ?? undefined,
        selection:
          submitted?.model && submitted.engine
            ? {
                model: submitted.model,
                engine: submitted.engine,
                provider: submitted.provider ?? submitted.engine,
              }
            : null,
      });
    },
    [start],
  );

  const open = useCallback((request: ReviewAgentRequest) => {
    const threadId = reviewAgentChatThreadId(request);
    if (threadId) requestAgentChatThreadOpen({ threadId });
  }, []);

  // A run whose dispatch never landed (reload, or classification finishing while
  // the tab was closed) carries its session; core makes re-dispatch idempotent.
  useEffect(() => {
    if (!active) return;
    for (const request of requests) {
      const session = request.requesterIsMe ? request.pendingSession : null;
      if (!session) continue;
      if (dispatchedRef.current.has(`${request.requestId}:${session.phase}`)) {
        continue;
      }
      void dispatchSession(request.requestId, session).then(refetch);
    }
  }, [active, dispatchSession, refetch, requests]);

  const monitorTargets = useMemo(
    () =>
      requests.flatMap((request) => {
        const target = monitorTargetFor(request);
        return target ? [target] : [];
      }),
    [requests],
  );
  const monitorTargetsRef = useRef(monitorTargets);
  monitorTargetsRef.current = monitorTargets;
  // Names exactly the runs being watched, so unrelated list changes keep the loops.
  const monitorKey = monitorTargets
    .map(
      (target) =>
        `${target.requestId}:${target.phase}:${target.receipt.turnId}`,
    )
    .join("|");
  useEffect(() => {
    if (!active || !monitorKey) return;
    let cancelled = false;
    // A call, so the compiler does not narrow it across the awaits below.
    const isCancelled = () => cancelled;
    const isCurrentIn = (
      list: readonly ReviewAgentRequest[],
      target: MonitorTarget,
    ) => {
      const current = monitorTargetFor(
        list.find((request) => request.requestId === target.requestId),
      );
      return (
        current !== null &&
        current.phase === target.phase &&
        current.receipt.turnId === target.receipt.turnId
      );
    };
    const watch = async (target: MonitorTarget) => {
      let retryDelay = ACTIVE_POLL_INTERVAL_MS;
      while (!isCancelled() && isCurrentIn(requestsRef.current, target)) {
        let snapshot: BackgroundAgentSessionSnapshot;
        try {
          snapshot = await getBackgroundAgentSessionStatus(target.receipt);
          retryDelay = ACTIVE_POLL_INTERVAL_MS;
        } catch {
          await sleep(retryDelay);
          retryDelay = Math.min(retryDelay * 2, MAX_STATUS_RETRY_DELAY_MS);
          continue;
        }
        // A terminal label without a run id can come from the transport before
        // the run exists, so it has no authority to finish the request.
        if (isTerminalRunStatus(snapshot.status) && snapshot.runId) {
          // The server hook usually finalised it already, or the phase moved on.
          const latest = await refetch();
          if (
            isCancelled() ||
            !isCurrentIn(latest ?? requestsRef.current, target)
          ) {
            return;
          }
          try {
            await reconcileSession({
              requestId: target.requestId,
              phase: target.phase,
              status: snapshot.status,
              runId: snapshot.runId,
              ...(snapshot.terminalReason
                ? { terminalReason: snapshot.terminalReason }
                : {}),
            });
          } catch (error) {
            console.warn(
              "[design] could not reconcile a review agent run",
              error,
            );
          }
          await refetch();
          return;
        }
        await sleep(ACTIVE_POLL_INTERVAL_MS);
      }
    };
    for (const target of monitorTargetsRef.current) void watch(target);
    return () => {
      cancelled = true;
    };
  }, [active, monitorKey, refetch]);

  // A run that just finished changed the thread, and maybe the design.
  useEffect(() => {
    const previous = previousStatusesRef.current;
    let commentsChanged = false;
    let designChanged = false;
    for (const request of requests) {
      const prior = previous.get(request.requestId);
      if (
        prior &&
        isReviewAgentActive(prior) &&
        !isReviewAgentActive(request.status)
      ) {
        commentsChanged = true;
        if (request.status === "applied" || request.result?.editApplied) {
          designChanged = true;
        }
      }
      previous.set(request.requestId, request.status);
    }
    if (commentsChanged) {
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-review-comments"],
      });
    }
    if (designChanged) {
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-design"],
      });
    }
  }, [queryClient, requests]);

  const requestForThread = useCallback(
    (threadId: string) => latestReviewAgentRequest(requests, threadId),
    [requests],
  );
  const isThreadBusy = useCallback(
    (threadId: string) => {
      if (startingNames.has(threadId)) return true;
      const now = Date.now();
      return requests.some(
        (request) =>
          request.threadId === threadId &&
          isReviewAgentRequestLive(request, now),
      );
    },
    [requests, startingNames],
  );
  const startingAgentName = useCallback(
    (threadId: string) => startingNames.get(threadId) ?? null,
    [startingNames],
  );

  return useMemo(
    () => ({
      enabled: active,
      requests,
      requestForThread,
      isThreadBusy,
      startingThreadIds,
      startingAgentName,
      stoppingRequestIds,
      start,
      stop,
      retry,
      open,
      models: { ready, options, selected },
      mentionOptions,
      resolveMention,
      markSurfaceUsed,
    }),
    [
      active,
      requests,
      requestForThread,
      isThreadBusy,
      startingThreadIds,
      startingAgentName,
      stoppingRequestIds,
      start,
      stop,
      retry,
      open,
      ready,
      options,
      selected,
      mentionOptions,
      resolveMention,
      markSurfaceUsed,
    ],
  );
}
