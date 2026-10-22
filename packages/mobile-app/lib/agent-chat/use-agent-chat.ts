import type { AgentRunHandle, AgentThreadState } from "@agent-native/agentkit";
import type { AgentEvent } from "@agent-native/agentkit/protocol";
import {
  ensureAgentEngineReadiness,
  getAgentEngineReadiness,
  invalidateAgentEngineReadiness,
  subscribeAgentEngineReadiness,
  type AgentEngineConfiguredState,
} from "@agent-native/core/client/agent-engine-readiness";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, DeviceEventEmitter } from "react-native";

import { trackMobileEvent } from "@/lib/analytics";

import {
  agentKitThreadToMobileTurnState,
  createMobileAgentKitSession,
  MOBILE_CHAT_METADATA,
  mobileAgentKitEventToWireEvent,
  mobileAttachmentsToAgentKitFiles,
  uploadMobileChatAttachments,
  type MobileAgentKitSession,
} from "./agentkit-mobile";
import {
  AgentChatError,
  DEFAULT_CHAT_BASE_URL,
  deleteNavigateCommand,
  fetchNavigateCommand,
  getMobileAgentChatHeaders,
  newThreadId,
  AGENT_ENGINE_CONFIGURED_CHANGED_EVENT,
  type MobileChatEligibility,
} from "./api";
import {
  forkAndResubmitMobileMessage,
  submitMobileMessageFeedback,
} from "./message-actions";
import { extractThreadId, navigateCommandDedupKey } from "./navigate-command";
import { applyWireEvent, cancelTurnState, nextLocalId } from "./reducer";
import type {
  ChatAttachment,
  ChatMessage,
  ChatReference,
  ChatSendOptions,
  ChatTurnState,
} from "./types";
import { isTerminalWireEvent, messageText } from "./types";
import { messageRunId, mobileChatScope } from "./version-history";

/**
 * Renders are throttled: wire deltas can arrive dozens of times per second,
 * so events fold into a mutable state buffer and flush to React on an
 * interval. Scroll/entering animations run on the UI thread regardless.
 */
const FLUSH_INTERVAL_MS = 50;
const NAVIGATE_POLL_INTERVAL_MS = 2000;
const NAVIGATE_POLL_TIMEOUT_MS = Math.max(
  10_000,
  NAVIGATE_POLL_INTERVAL_MS * 4,
);
const QUEUED_RECEIPT_POLL_INTERVAL_MS = 1_000;
const QUEUED_RECEIPT_STATUS_TIMEOUT_MS = 10_000;

function waitForQueuedReceiptPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, QUEUED_RECEIPT_POLL_INTERVAL_MS);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}
/**
 * Bounds `call` so a hung request can't pin the poll's `inFlight` guard
 * forever. `call` keeps running if it loses the race, but nothing awaits it
 * beyond this, so a late resolution can't clobber a newer poll cycle.
 */
function withPollTimeout<T>(call: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Poll timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

function withAbortablePollTimeout<T>(
  call: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let abortHandler = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    abortHandler = () => {
      controller.abort();
      const error = new Error("Poll aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (signal.aborted) {
      abortHandler();
    } else {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
  const operation = Promise.resolve().then(() => {
    if (controller.signal.aborted) {
      const error = new Error("Poll aborted");
      error.name = "AbortError";
      throw error;
    }
    return call(controller.signal);
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Poll timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([operation, timeout, aborted]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener("abort", abortHandler);
    controller.abort();
  });
}

export interface AgentChatSettings {
  model?: string;
  engine?: string;
  effort?: string;
  mode?: "act" | "plan";
}

export interface AgentChatController {
  threadId: string;
  /** Origin app base URL of the active thread (defaults to the chat app). */
  baseUrl: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  activity: string | null;
  error: string | null;
  errorCode: string | null;
  authRequired: boolean;
  historyLoading: boolean;
  chatEligibility: MobileChatEligibility;
  canChat: boolean;
  send: (
    text: string,
    attachments?: ChatAttachment[],
    references?: ChatReference[],
  ) => Promise<boolean>;
  stop: () => void;
  approve: (approvalKey: string) => void;
  deny: (approvalKey?: string) => void;
  continueAfterConnection: (requestId: string, provider: string) => void;
  invokeWidgetAction: (
    widgetId: string,
    action: string,
    payload?: unknown,
  ) => Promise<void>;
  editMessage: (messageId: string, text: string) => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  submitFeedback: (
    messageId: string,
    value: "positive" | "negative",
  ) => Promise<void>;
  retry: () => void;
  newChat: (baseUrl?: string) => void;
  /** Open a thread; pass its origin app base URL for cross-app threads. */
  openThread: (threadId: string, baseUrl?: string) => void;
  clearAuthRequired: () => void;
  refreshChatEligibility: () => void;
  /** Run id of the turn that produced this assistant message, if known. */
  getRunId: (messageId: string) => string | null;
}

interface LiveTurn {
  abort: () => void;
  runId: string | null;
  queued?: boolean;
}

interface ActiveTurnBuffer {
  generation: number;
  assistantId: string;
  runId: string | null;
  processedEventIds?: Set<string>;
  queuedMessageId?: string;
  queuedRunCompleted?: () => void;
  awaitingQueuedHandle?: boolean;
  earlyQueuedEvents?: Map<string, AgentEvent[]>;
  earlyQueuedRunIds?: Map<string, string>;
  earlyRunEvents?: Map<string, AgentEvent[]>;
  state: ChatTurnState;
  dirty: boolean;
  sawTerminal: boolean;
  sawApproval: boolean;
  acceptEvents: boolean;
}

function queuedMessageIdFromEvent(event: AgentEvent): string | null {
  const custom = event.metadata?.custom;
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) {
    return null;
  }
  const id = (custom as Record<string, unknown>).agentNativeQueuedMessageId;
  return typeof id === "string" ? id : null;
}

interface PendingApproval {
  approvalId: string;
  runId: string;
  assistantId: string;
  threadId: string;
  session: MobileAgentKitSession;
  resolving: boolean;
}

class MobileChatSetupRequiredError extends Error {
  readonly code: "missing_api_key" | "chat_setup_unavailable";

  constructor(readonly state: "missing" | "unavailable") {
    super(
      state === "missing"
        ? "No Builder AI or custom provider API key is connected."
        : "Chat setup could not be confirmed. Retry to check again.",
    );
    this.name = "MobileChatSetupRequiredError";
    this.code =
      state === "missing" ? "missing_api_key" : "chat_setup_unavailable";
  }
}

function toMobileChatEligibility(
  state: AgentEngineConfiguredState,
): MobileChatEligibility {
  switch (state) {
    case "unknown":
      return "checking";
    case "configured":
      return "eligible";
    default:
      return state;
  }
}

function eventTurnId(event: AgentEvent): string | undefined {
  const metadata = event.metadata as Record<string, unknown> | undefined;
  const mobile = metadata?.[MOBILE_CHAT_METADATA];
  return mobile &&
    typeof mobile === "object" &&
    "turnId" in mobile &&
    typeof mobile.turnId === "string"
    ? mobile.turnId
    : undefined;
}

function annotateAssistantMessage(
  state: ChatTurnState,
  assistantId: string,
  event: AgentEvent,
): ChatTurnState {
  const last = state.messages.at(-1);
  if (!last || last.id !== assistantId) return state;
  const scope = mobileChatScope(event.metadata);
  const turnId = eventTurnId(event);
  const updated = {
    ...last,
    metadata: {
      ...last.metadata,
      runId: event.runId,
      ...(turnId ? { turnId } : {}),
      ...(scope ? { chatScope: scope } : {}),
    },
  };
  return { ...state, messages: [...state.messages.slice(0, -1), updated] };
}

export function useAgentChat(settings: AgentChatSettings): AgentChatController {
  const [threadId, setThreadId] = useState(() => newThreadId());
  const [state, setState] = useState<ChatTurnState>(() => ({
    messages: [],
    activity: null,
    isStreaming: false,
    error: null,
    errorCode: null,
    runId: null,
  }));
  const [authRequired, setAuthRequired] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_CHAT_BASE_URL);
  const readinessSource = useMemo(
    () => ({
      statusUrl: `${baseUrl.replace(/\/+$/, "")}/_agent-native/agent-engine/status`,
      headers: async () => {
        try {
          return await getMobileAgentChatHeaders();
        } catch (error) {
          if (error instanceof AgentChatError && error.authRequired) {
            setAuthRequired(true);
          }
          throw error;
        }
      },
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await fetch(input, init);
        if (response.status === 401) setAuthRequired(true);
        return response;
      },
    }),
    [baseUrl],
  );
  const readChatEligibility = useCallback(
    () => toMobileChatEligibility(getAgentEngineReadiness(readinessSource)),
    [readinessSource],
  );
  const subscribeToChatEligibility = useCallback(
    (listener: () => void) =>
      subscribeAgentEngineReadiness(listener, { source: readinessSource }),
    [readinessSource],
  );
  const chatEligibility = useSyncExternalStore(
    subscribeToChatEligibility,
    readChatEligibility,
    readChatEligibility,
  );

  const stateRef = useRef(state);
  stateRef.current = state;
  // Async turn/resume closures read the live value, not the render-time one.
  const baseUrlRef = useRef(baseUrl);
  baseUrlRef.current = baseUrl;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const liveTurnRef = useRef<LiveTurn | null>(null);
  const activeTurnBufferRef = useRef<ActiveTurnBuffer | null>(null);
  const pendingApprovalRef = useRef<PendingApproval | null>(null);
  const mountedRef = useRef(true);
  const lastPromptRef = useRef<string | null>(null);
  const lastExtraRef = useRef<
    Pick<ChatSendOptions, "attachments" | "references">
  >({});
  const pendingForkRetryRef = useRef<{
    messageId: string;
    text?: string;
  } | null>(null);
  const retryPendingForkRef = useRef<
    ((pending: { messageId: string; text?: string }) => Promise<void>) | null
  >(null);
  const pendingForkRetryInFlightRef = useRef(false);
  const runIdsRef = useRef(new Map<string, string>());
  const assistantIdsByRunRef = useRef(new Map<string, string>());
  const processedEventIdsRef = useRef(new Map<string, Set<string>>());
  const sessionsRef = useRef(new Map<string, MobileAgentKitSession>());
  const connectionSessionByRequestRef = useRef(
    new Map<string, { session: MobileAgentKitSession; runId: string }>(),
  );
  const activeGenerationRef = useRef(0);
  const lastProcessedWriteIdRef = useRef<string | null>(null);
  const chatEligibilityRef = useRef(chatEligibility);
  chatEligibilityRef.current = chatEligibility;
  const dispatchCheckInFlightRef = useRef<string | null>(null);

  const checkChatEligibility = useCallback(
    async (force = false): Promise<MobileChatEligibility> => {
      const state = await ensureAgentEngineReadiness({
        source: readinessSource,
        fresh: force,
        timeoutMs: 10_000,
      });
      const eligibility = toMobileChatEligibility(state);
      if (
        eligibility === "eligible" &&
        stateRef.current.errorCode === "missing_api_key"
      ) {
        const recovered = {
          ...stateRef.current,
          error: null,
          errorCode: null,
        };
        stateRef.current = recovered;
        setState(recovered);
      }
      return eligibility;
    },
    [readinessSource],
  );

  const refreshChatEligibility = useCallback(() => {
    invalidateAgentEngineReadiness(readinessSource);
    void checkChatEligibility(true);
  }, [checkChatEligibility, readinessSource]);

  const requireChatEligibility = useCallback(
    async (force = false) => {
      const eligibility = await checkChatEligibility(force);
      if (eligibility === "eligible") return;
      throw new MobileChatSetupRequiredError(
        eligibility === "missing" ? "missing" : "unavailable",
      );
    },
    [checkChatEligibility],
  );

  const showSetupRequiredError = useCallback((error: unknown) => {
    if (!(error instanceof MobileChatSetupRequiredError)) return;
    const nextState = {
      ...stateRef.current,
      isStreaming: false,
      activity: null,
      error: error.message,
      errorCode: error.code,
    };
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const processSessionEvent = useCallback(
    (
      session: MobileAgentKitSession,
      event: AgentEvent,
      targetBaseUrl: string,
      targetThreadId: string,
    ) => {
      if (baseUrlRef.current !== targetBaseUrl) return;
      const active = activeTurnBufferRef.current;
      if (
        !active ||
        !active.acceptEvents ||
        active.generation !== activeGenerationRef.current
      ) {
        return;
      }
      if (active.processedEventIds?.has(event.id)) return;
      if (active.awaitingQueuedHandle) {
        const eventQueuedMessageId = queuedMessageIdFromEvent(event);
        const queuedMessageId =
          eventQueuedMessageId ?? active.earlyQueuedRunIds?.get(event.runId);
        if (eventQueuedMessageId) {
          active.earlyQueuedRunIds ??= new Map();
          active.earlyQueuedRunIds.set(event.runId, eventQueuedMessageId);
        }
        if (queuedMessageId) {
          active.earlyQueuedEvents ??= new Map();
          const events =
            active.earlyQueuedEvents.get(queuedMessageId) ??
            active.earlyRunEvents?.get(event.runId) ??
            [];
          events.push(event);
          active.earlyQueuedEvents.set(queuedMessageId, events);
          active.earlyRunEvents?.delete(event.runId);
          return;
        }
        active.earlyRunEvents ??= new Map();
        const events = active.earlyRunEvents.get(event.runId) ?? [];
        events.push(event);
        active.earlyRunEvents.set(event.runId, events);
        return;
      }
      if (active.queuedMessageId) {
        if (!active.runId) {
          if (queuedMessageIdFromEvent(event) !== active.queuedMessageId) {
            return;
          }
          active.runId = event.runId;
          void trackMobileEvent(
            "agent_chat_run_started",
            {
              chat_surface: "mobile",
              thread_id: targetThreadId,
              run_id: event.runId,
            },
            baseUrlRef.current,
          );
        } else if (active.runId !== event.runId) {
          return;
        }
      }
      const pendingApproval = pendingApprovalRef.current;
      if (active.runId && active.runId !== event.runId) {
        const resumedApproval =
          event.type === "approval.resolved" &&
          pendingApproval?.resolving &&
          pendingApproval.runId === active.runId &&
          pendingApproval.approvalId === event.approvalId;
        if (!resumedApproval) return;
        pendingApprovalRef.current = null;
      } else if (
        event.type === "approval.resolved" &&
        pendingApproval?.resolving &&
        pendingApproval.runId === event.runId &&
        pendingApproval.approvalId === event.approvalId
      ) {
        pendingApprovalRef.current = null;
      }
      active.processedEventIds ??= new Set();
      active.processedEventIds.add(event.id);
      active.runId = event.runId;
      if (event.type === "connection.requested") {
        connectionSessionByRequestRef.current.set(event.request.id, {
          session,
          runId: event.runId,
        });
      } else if (
        event.type === "connection.updated" &&
        event.request.status !== "connecting"
      ) {
        connectionSessionByRequestRef.current.delete(event.request.id);
      }
      assistantIdsByRunRef.current.set(event.runId, active.assistantId);
      runIdsRef.current.set(active.assistantId, event.runId);
      if (liveTurnRef.current) liveTurnRef.current.runId = event.runId;
      const wireEvent = mobileAgentKitEventToWireEvent(event);
      if (!wireEvent) return;
      const scopeValue = mobileChatScope(event.metadata);
      const wire = scopeValue ? { ...wireEvent, scope: scopeValue } : wireEvent;
      if (event.type === "approval.requested") {
        pendingApprovalRef.current = {
          approvalId: event.request.id,
          runId: event.runId,
          assistantId: active.assistantId,
          threadId: event.threadId,
          session,
          resolving: false,
        };
        active.sawApproval = true;
      }
      if (
        wire.type === "missing_api_key" ||
        wire.errorCode === "missing_api_key"
      ) {
        invalidateAgentEngineReadiness(readinessSource);
        void checkChatEligibility(true);
      }
      if (isTerminalWireEvent(wire)) active.sawTerminal = true;
      active.state = annotateAssistantMessage(
        applyWireEvent(active.state, wire, active.assistantId),
        active.assistantId,
        event,
      );
      active.dirty = true;
      if (wire.type !== "connection_required" && isTerminalWireEvent(wire)) {
        if (!active.awaitingQueuedHandle) {
          activeTurnBufferRef.current = null;
          liveTurnRef.current = null;
        }
        active.queuedRunCompleted?.();
        active.queuedRunCompleted = undefined;
      }
    },
    [checkChatEligibility, readinessSource],
  );

  useEffect(() => {
    void checkChatEligibility(true);
  }, [baseUrl, checkChatEligibility]);

  useEffect(() => {
    const setupChangedSubscription = DeviceEventEmitter.addListener(
      AGENT_ENGINE_CONFIGURED_CHANGED_EVENT,
      refreshChatEligibility,
    );
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active") refreshChatEligibility();
      },
    );
    return () => {
      setupChangedSubscription.remove();
      appStateSubscription.remove();
    };
  }, [refreshChatEligibility]);

  const getSession = useCallback(
    (targetBaseUrl: string, scope?: { type: string; id: string }) => {
      const currentSettings = settingsRef.current;
      const sessionKey = JSON.stringify([
        targetBaseUrl,
        currentSettings.engine ?? "",
        currentSettings.mode ?? "",
        scope?.type ?? "",
        scope?.id ?? "",
      ]);
      const existing = sessionsRef.current.get(sessionKey);
      if (existing) return existing;
      const session = createMobileAgentKitSession({
        baseUrl: targetBaseUrl,
        settings: {
          ...(currentSettings.engine ? { engine: currentSettings.engine } : {}),
          ...(currentSettings.mode ? { mode: currentSettings.mode } : {}),
        },
        ...(scope ? { scope } : {}),
        onError: (error) => {
          if (baseUrlRef.current !== targetBaseUrl) return;
          const active = activeTurnBufferRef.current;
          if (!active) return;
          active.state = {
            ...active.state,
            isStreaming: false,
            activity: null,
            error: error.message,
            errorCode: null,
          };
          active.dirty = true;
        },
      });
      session.client.subscribe(() => {
        if (baseUrlRef.current !== targetBaseUrl) return;
        const targetThreadId = threadIdRef.current;
        const thread = session.client.getThread(targetThreadId);
        const processed =
          processedEventIdsRef.current.get(targetThreadId) ?? new Set<string>();
        processedEventIdsRef.current.set(targetThreadId, processed);
        for (const event of thread.events) {
          if (processed.has(event.id)) continue;
          processed.add(event.id);
          processSessionEvent(session, event, targetBaseUrl, targetThreadId);
        }
      });
      sessionsRef.current.set(sessionKey, session);
      return session;
    },
    [processSessionEvent],
  );
  getSession(baseUrl);

  const markThreadEventsSeen = useCallback(
    (targetThreadId: string, events: Array<{ id: string }>) => {
      processedEventIdsRef.current.set(
        targetThreadId,
        new Set(events.map((event) => event.id)),
      );
    },
    [],
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      liveTurnRef.current?.abort();
      for (const session of sessionsRef.current.values()) {
        void session.dispose();
      }
    };
  }, []);

  const runTurn = useCallback(
    async (
      text: string,
      extra: Pick<ChatSendOptions, "attachments" | "references"> = {},
      currentThreadId?: string,
      options?: {
        forceReadiness?: boolean;
        replaceFailedAttempt?: boolean;
        onDispatchResult?: (accepted: boolean) => void;
      },
    ) => {
      let dispatchResultReported = false;
      const reportDispatchResult = (accepted: boolean) => {
        if (dispatchResultReported) return;
        dispatchResultReported = true;
        options?.onDispatchResult?.(accepted);
      };
      if (stateRef.current.isStreaming) {
        reportDispatchResult(false);
        return;
      }
      const activeThreadId = currentThreadId ?? threadIdRef.current;
      const targetBaseUrl = baseUrlRef.current;
      const dispatchKey = JSON.stringify([targetBaseUrl, activeThreadId]);
      if (dispatchCheckInFlightRef.current === dispatchKey) {
        reportDispatchResult(false);
        return;
      }
      lastPromptRef.current = text;
      lastExtraRef.current = extra;
      dispatchCheckInFlightRef.current = dispatchKey;
      try {
        await requireChatEligibility(
          options?.forceReadiness ??
            chatEligibilityRef.current === "unavailable",
        );
      } catch (error) {
        if (
          mountedRef.current &&
          threadIdRef.current === activeThreadId &&
          baseUrlRef.current === targetBaseUrl
        ) {
          showSetupRequiredError(error);
        }
        reportDispatchResult(false);
        return;
      } finally {
        if (dispatchCheckInFlightRef.current === dispatchKey) {
          dispatchCheckInFlightRef.current = null;
        }
      }
      if (
        !mountedRef.current ||
        threadIdRef.current !== activeThreadId ||
        baseUrlRef.current !== targetBaseUrl
      ) {
        reportDispatchResult(false);
        return;
      }
      const currentGeneration = ++activeGenerationRef.current;
      let session = getSession(targetBaseUrl);
      let currentAgentKit = session.client;
      pendingApprovalRef.current = null;
      void trackMobileEvent(
        "agent_chat_turn_started",
        {
          chat_surface: "mobile",
          thread_id: activeThreadId,
          turn_kind: "message",
          has_attachments: Boolean(extra.attachments?.length),
          reference_count: extra.references?.length ?? 0,
        },
        baseUrlRef.current,
      );
      if (options?.replaceFailedAttempt) {
        const messages = [...stateRef.current.messages];
        const last = messages[messages.length - 1];
        if (last?.role === "assistant") messages.pop();
        const secondLast = messages[messages.length - 1];
        if (
          secondLast?.role === "user" &&
          messageText(secondLast).trim() === text
        ) {
          messages.pop();
        }
        const recovered = {
          ...stateRef.current,
          messages,
          error: null,
          errorCode: null,
        };
        stateRef.current = recovered;
        setState(recovered);
      }
      const committed = stateRef.current.messages;
      const userMessage: ChatMessage = {
        id: nextLocalId("user"),
        role: "user",
        parts: [
          ...(extra.attachments ?? [])
            .filter((a) => a.type === "image" && a.data)
            .map((a) => ({
              type: "image" as const,
              dataUrl: a.data!,
              name: a.name,
            })),
          { type: "text", text },
        ],
        createdAt: Date.now(),
      };
      const assistantId = nextLocalId("assistant");

      let buffered: ChatTurnState = {
        ...stateRef.current,
        messages: [...committed, userMessage],
        isStreaming: true,
        activity: null,
        error: null,
        errorCode: null,
      };
      const turnBuffer: ActiveTurnBuffer = {
        generation: currentGeneration,
        assistantId,
        runId: null,
        state: buffered,
        dirty: false,
        sawTerminal: false,
        sawApproval: false,
        acceptEvents: false,
      };
      activeTurnBufferRef.current = turnBuffer;
      stateRef.current = buffered;
      setState(buffered);

      const flushTimer = setInterval(() => {
        if (
          turnBuffer.dirty &&
          mountedRef.current &&
          activeGenerationRef.current === currentGeneration
        ) {
          turnBuffer.dirty = false;
          stateRef.current = turnBuffer.state;
          setState(turnBuffer.state);
        }
      }, FLUSH_INTERVAL_MS);

      let queuedMessageReservationId: string | undefined;
      try {
        const controller = new AbortController();
        let activeRunIdsBeforeSend = new Set<string>();
        let sendPromise: Promise<AgentRunHandle> | undefined;
        let sendHandle: AgentRunHandle | undefined;
        let stopRequested = false;
        let stopReconciliation: Promise<void> | undefined;
        const reconcileStoppedDispatch = (): Promise<void> => {
          stopRequested = true;
          controller.abort();
          if (!queuedMessageReservationId) return Promise.resolve();
          if (!sendPromise) {
            currentAgentKit.cancelQueuedMessageReservation?.(
              activeThreadId,
              queuedMessageReservationId,
            );
            return Promise.resolve();
          }
          if (stopReconciliation) return stopReconciliation;
          stopReconciliation = (async () => {
            let sendFailure: unknown;
            try {
              sendHandle ??= await sendPromise;
            } catch (error) {
              sendFailure = error;
            }
            const messageId = queuedMessageReservationId!;
            const getStatus = session.client.getQueuedSubmissionStatus;
            let status;
            let statusFailure: unknown;
            if (getStatus) {
              try {
                status = await getStatus.call(session.client, {
                  threadId: activeThreadId,
                  messageId,
                });
              } catch (error) {
                statusFailure = error;
              }
            }
            const directRunId =
              sendHandle &&
              "runId" in sendHandle &&
              !activeRunIdsBeforeSend.has(sendHandle.runId)
                ? sendHandle.runId
                : undefined;
            if (!status && directRunId) {
              await session.client.cancelRun(activeThreadId, directRunId);
              return;
            }
            if (!status || status.state === "queued") {
              let removalFailure: unknown;
              try {
                await session.client.removeQueuedMessage(
                  activeThreadId,
                  messageId,
                );
              } catch (error) {
                removalFailure = error;
              }
              if (getStatus) {
                try {
                  status = await getStatus.call(session.client, {
                    threadId: activeThreadId,
                    messageId,
                  });
                } catch (error) {
                  status = undefined;
                  statusFailure = error;
                }
              }
              if (removalFailure && status?.state === "queued") {
                throw new Error("The queued message could not be stopped.", {
                  cause: removalFailure,
                });
              }
            }
            if (status?.state === "submitted") {
              if (!status.submittedRunId) {
                throw new Error("The queued message could not be stopped.");
              }
              await session.client.cancelRun(
                activeThreadId,
                status.submittedRunId,
              );
              return;
            }
            if (
              status?.state === "removed" ||
              status?.state === "expired" ||
              status?.state === "blocked"
            ) {
              return;
            }
            throw new Error("The queued message could not be stopped.", {
              cause: statusFailure ?? sendFailure,
            });
          })().catch((error: unknown) => {
            if (activeGenerationRef.current !== currentGeneration) return;
            turnBuffer.state = {
              ...turnBuffer.state,
              isStreaming: false,
              activity: null,
              error:
                error instanceof Error
                  ? error.message
                  : "The queued message could not be stopped.",
              errorCode: "queued_cancel_failed",
            };
            turnBuffer.sawTerminal = true;
            turnBuffer.dirty = true;
            stateRef.current = turnBuffer.state;
            setState(turnBuffer.state);
          });
          return stopReconciliation;
        };
        liveTurnRef.current = {
          abort: () => {
            void reconcileStoppedDispatch();
          },
          runId: null,
        };

        let loaded = await currentAgentKit.loadThread(activeThreadId, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (activeGenerationRef.current !== currentGeneration) return;
        const chatScope = [...loaded.messages]
          .reverse()
          .map((message) => mobileChatScope(message.metadata))
          .find((scope) => scope !== null);
        if (chatScope) {
          session = getSession(targetBaseUrl, chatScope);
          currentAgentKit = session.client;
          loaded = await currentAgentKit.loadThread(activeThreadId, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (activeGenerationRef.current !== currentGeneration) return;
        }
        activeRunIdsBeforeSend = new Set(loaded.activeRunIds);
        markThreadEventsSeen(activeThreadId, loaded.events);
        turnBuffer.acceptEvents = true;
        turnBuffer.awaitingQueuedHandle = true;
        turnBuffer.earlyQueuedEvents = new Map();
        turnBuffer.earlyQueuedRunIds = new Map();
        turnBuffer.earlyRunEvents = new Map();
        const reservation = currentAgentKit.reserveQueuedMessage?.({
          threadId: activeThreadId,
          text,
        }) ?? {
          id: nextLocalId("queued"),
          threadId: activeThreadId,
          text,
          createdAt: new Date().toISOString(),
        };
        queuedMessageReservationId = reservation.id;
        const durableAttachments = await uploadMobileChatAttachments(
          currentAgentKit,
          activeThreadId,
          extra.attachments,
        );
        if (controller.signal.aborted) {
          currentAgentKit.cancelQueuedMessageReservation?.(
            activeThreadId,
            reservation.id,
          );
          return;
        }
        const details = durableAttachments.map(
          ({ type, name, contentType, url }) => ({
            type,
            name,
            ...(contentType ? { contentType } : {}),
            url,
          }),
        );
        sendPromise = currentAgentKit.sendMessage(
          {
            threadId: activeThreadId,
            text,
            queuedMessageReservationId: reservation.id,
            attachments: mobileAttachmentsToAgentKitFiles(durableAttachments),
            options: {
              ...(settingsRef.current.model
                ? { model: settingsRef.current.model }
                : {}),
              ...(settingsRef.current.mode
                ? { mode: settingsRef.current.mode }
                : {}),
              ...(settingsRef.current.effort &&
              ["none", "minimal", "low", "medium", "high", "xhigh"].includes(
                settingsRef.current.effort,
              )
                ? {
                    reasoningEffort: settingsRef.current.effort as
                      | "none"
                      | "minimal"
                      | "low"
                      | "medium"
                      | "high"
                      | "xhigh",
                  }
                : {}),
            },
            metadata: {
              ...(chatScope ? { chatScope } : {}),
              [MOBILE_CHAT_METADATA]: {
                turnId: nextLocalId("turn"),
                ...(chatScope ? { scope: chatScope } : {}),
                ...(extra.references?.length
                  ? { references: extra.references }
                  : {}),
                ...(details.length ? { attachmentDetails: details } : {}),
              },
            },
          },
          { signal: controller.signal },
        );
        const runHandle = await sendPromise;
        sendHandle = runHandle;
        reportDispatchResult(true);

        if (stopRequested) {
          await stopReconciliation;
          return;
        }

        if (activeGenerationRef.current !== currentGeneration) {
          return;
        }

        const queuedRunHandle = "queuedMessageId" in runHandle;
        const queuedHandle = queuedRunHandle ? runHandle : null;
        const runId = "runId" in runHandle ? runHandle.runId : null;
        liveTurnRef.current = {
          abort: () => {
            if (queuedHandle) {
              const queuedRunId = turnBuffer.runId;
              void (async () => {
                if (queuedRunId && queuedRunId !== queuedHandle.activeRunId) {
                  await session.client.cancelRun(activeThreadId, queuedRunId);
                } else {
                  await queuedHandle.cancel();
                }
                if (
                  activeGenerationRef.current === currentGeneration &&
                  !turnBuffer.sawTerminal
                ) {
                  turnBuffer.state = cancelTurnState(
                    turnBuffer.state,
                    assistantId,
                  );
                  turnBuffer.sawTerminal = true;
                  turnBuffer.dirty = true;
                  stateRef.current = turnBuffer.state;
                  setState(turnBuffer.state);
                }
                controller.abort();
              })().catch((error: unknown) => {
                if (activeGenerationRef.current !== currentGeneration) return;
                const message =
                  error instanceof Error
                    ? error.message
                    : "The queued message could not be stopped.";
                turnBuffer.state = {
                  ...turnBuffer.state,
                  error: message,
                  errorCode: "queued_cancel_failed",
                };
                turnBuffer.dirty = true;
                stateRef.current = turnBuffer.state;
                setState(turnBuffer.state);
              });
              return;
            }
            controller.abort();
            void runHandle.cancel();
          },
          runId,
          queued: queuedRunHandle,
        };
        if ("queuedMessageId" in runHandle) {
          turnBuffer.awaitingQueuedHandle = false;
          turnBuffer.queuedMessageId = runHandle.queuedMessageId;
          turnBuffer.runId =
            [...(turnBuffer.earlyQueuedRunIds ?? [])].find(
              ([, queuedMessageId]) =>
                queuedMessageId === runHandle.queuedMessageId,
            )?.[0] ?? null;
          turnBuffer.sawTerminal = false;
          turnBuffer.acceptEvents = true;
          const earlyRunEvents = turnBuffer.earlyRunEvents;
          for (const [earlyRunId, events] of earlyRunEvents ?? []) {
            let priorAssistantId = assistantIdsByRunRef.current.get(earlyRunId);
            if (!priorAssistantId) {
              priorAssistantId = turnBuffer.state.messages.find(
                (message) =>
                  message.role === "assistant" &&
                  messageRunId(message) === earlyRunId,
              )?.id;
            }
            for (const event of events) {
              if (turnBuffer.processedEventIds?.has(event.id)) continue;
              const wireEvent = mobileAgentKitEventToWireEvent(event);
              if (!wireEvent) continue;
              priorAssistantId ??= nextLocalId("assistant");
              if (
                !turnBuffer.state.messages.some(
                  (message) => message.id === priorAssistantId,
                ) &&
                wireEvent.type !== "activity" &&
                wireEvent.type !== "done" &&
                wireEvent.type !== "loop_limit" &&
                wireEvent.type !== "auto_continue"
              ) {
                const messages = [...turnBuffer.state.messages];
                const queuedUserIndex = messages.findIndex(
                  (message) => message.id === userMessage.id,
                );
                messages.splice(
                  queuedUserIndex < 0 ? messages.length : queuedUserIndex,
                  0,
                  {
                    id: priorAssistantId,
                    role: "assistant",
                    parts: [],
                    createdAt: Date.now(),
                    metadata: { runId: earlyRunId },
                  },
                );
                turnBuffer.state = { ...turnBuffer.state, messages };
              }
              if (
                !turnBuffer.state.messages.some(
                  (message) => message.id === priorAssistantId,
                )
              ) {
                continue;
              }
              turnBuffer.processedEventIds ??= new Set();
              turnBuffer.processedEventIds.add(event.id);
              assistantIdsByRunRef.current.set(earlyRunId, priorAssistantId);
              runIdsRef.current.set(priorAssistantId, earlyRunId);
              const scopeValue = mobileChatScope(event.metadata);
              const wire = scopeValue
                ? { ...wireEvent, scope: scopeValue }
                : wireEvent;
              const current = turnBuffer.state;
              const next = applyWireEvent(current, wire, priorAssistantId);
              turnBuffer.state = annotateBufferedAssistantMessage(
                {
                  ...next,
                  isStreaming: current.isStreaming,
                  activity: current.activity,
                  error: current.error,
                  errorCode: current.errorCode,
                  runId: turnBuffer.runId,
                },
                priorAssistantId,
                event,
              );
              turnBuffer.dirty = true;
            }
          }
          turnBuffer.earlyRunEvents = undefined;
          turnBuffer.earlyQueuedRunIds = undefined;
          const queuedEvents =
            turnBuffer.earlyQueuedEvents?.get(runHandle.queuedMessageId) ?? [];
          turnBuffer.earlyQueuedEvents = undefined;
          if (
            activeTurnBufferRef.current === null ||
            activeTurnBufferRef.current === turnBuffer
          ) {
            activeTurnBufferRef.current = turnBuffer;
          }
          if (turnBuffer.runId) {
            void trackMobileEvent(
              "agent_chat_run_started",
              {
                chat_surface: "mobile",
                thread_id: activeThreadId,
                run_id: turnBuffer.runId,
              },
              baseUrlRef.current,
            );
          }
          void runHandle.completed.catch(() => {});
          let stopReceiptPolling = false;
          const failQueueReceiptStatus = (error: string, errorCode: string) => {
            if (
              activeGenerationRef.current !== currentGeneration ||
              controller.signal.aborted
            ) {
              return;
            }
            turnBuffer.state = applyWireEvent(
              turnBuffer.state,
              { type: "error", error, errorCode },
              assistantId,
            );
            turnBuffer.sawTerminal = true;
            turnBuffer.dirty = true;
            turnBuffer.queuedRunCompleted?.();
          };
          const pollQueuedReceipt = async () => {
            const getStatus = session.client.getQueuedSubmissionStatus;
            if (!getStatus) {
              failQueueReceiptStatus(
                "Could not confirm whether this queued message will run. Check the queue before retrying.",
                "queued_submission_status_unavailable",
              );
              return;
            }
            while (!stopReceiptPolling && !controller.signal.aborted) {
              let receipt;
              try {
                receipt = await withAbortablePollTimeout(
                  (signal) =>
                    getStatus.call(
                      session.client,
                      {
                        threadId: activeThreadId,
                        messageId: runHandle.queuedMessageId,
                      },
                      { signal },
                    ),
                  controller.signal,
                  QUEUED_RECEIPT_STATUS_TIMEOUT_MS,
                );
              } catch (error) {
                if (controller.signal.aborted) return;
                const status =
                  error && typeof error === "object" && "status" in error
                    ? error.status
                    : undefined;
                if (status === 404 || status === 501) {
                  failQueueReceiptStatus(
                    "Could not confirm whether this queued message will run. Check the queue before retrying.",
                    "queued_submission_status_unavailable",
                  );
                  return;
                }
                const retryable =
                  error && typeof error === "object" && "retryable" in error
                    ? error.retryable
                    : error instanceof TypeError;
                if (retryable !== true) {
                  if (status === 401) setAuthRequired(true);
                  failQueueReceiptStatus(
                    "Could not confirm whether this queued message will run. Check the queue before retrying.",
                    "queued_submission_status_unavailable",
                  );
                  return;
                }
                await waitForQueuedReceiptPoll(controller.signal);
                continue;
              }
              if (receipt === undefined) {
                failQueueReceiptStatus(
                  "Could not confirm whether this queued message will run. Check the queue before retrying.",
                  "queued_submission_status_unavailable",
                );
                return;
              }
              if (receipt === null) {
                failQueueReceiptStatus(
                  "Could not confirm whether this queued message will run. Check the queue before retrying.",
                  "queued_submission_status_unavailable",
                );
                return;
              }
              if (receipt?.state === "submitted") {
                const submittedRunId = receipt.submittedRunId;
                if (!submittedRunId) {
                  failQueueReceiptStatus(
                    "Could not confirm whether this queued message will run. Check the queue before retrying.",
                    "queued_submission_status_unavailable",
                  );
                  return;
                }
                turnBuffer.runId = submittedRunId;
                assistantIdsByRunRef.current.set(submittedRunId, assistantId);
                runIdsRef.current.set(assistantId, submittedRunId);
                const submittedEvents = session.client
                  .getThread(activeThreadId)
                  .events.filter((event) => event.runId === submittedRunId)
                  .sort((left, right) => left.sequence - right.sequence);
                for (const event of submittedEvents) {
                  processSessionEvent(
                    session,
                    event,
                    targetBaseUrl,
                    activeThreadId,
                  );
                  if (stopReceiptPolling) return;
                }
                try {
                  await session.client.resubscribeRun(
                    activeThreadId,
                    submittedRunId,
                  );
                } catch {
                  if (!controller.signal.aborted && !stopReceiptPolling) {
                    failQueueReceiptStatus(
                      "The connection to the agent dropped before it finished. Retry to continue.",
                      "stream_dropped",
                    );
                  }
                  return;
                }
                if (controller.signal.aborted || stopReceiptPolling) return;
                if (turnBuffer.sawTerminal || turnBuffer.sawApproval) {
                  turnBuffer.queuedRunCompleted?.();
                } else {
                  failQueueReceiptStatus(
                    "The connection to the agent dropped before it finished. Retry to continue.",
                    "stream_dropped",
                  );
                }
                return;
              }
              if (
                receipt?.state === "expired" ||
                receipt?.state === "blocked" ||
                receipt?.state === "removed"
              ) {
                const error =
                  receipt.state === "expired"
                    ? "This queued message expired before it could run."
                    : receipt.state === "removed"
                      ? "This queued message was removed before it could run."
                      : "This queued message could not be started.";
                failQueueReceiptStatus(
                  error,
                  `queued_submission_${receipt.state}`,
                );
                return;
              }
              await waitForQueuedReceiptPoll(controller.signal);
            }
          };
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              stopReceiptPolling = true;
              controller.signal.removeEventListener("abort", finish);
              if (turnBuffer.queuedRunCompleted === finish) {
                turnBuffer.queuedRunCompleted = undefined;
              }
              resolve();
            };
            turnBuffer.queuedRunCompleted = finish;
            if (controller.signal.aborted) {
              finish();
            } else {
              controller.signal.addEventListener("abort", finish, {
                once: true,
              });
            }
            for (const event of queuedEvents) {
              processSessionEvent(
                session,
                event,
                targetBaseUrl,
                activeThreadId,
              );
            }
            if (!stopReceiptPolling) void pollQueuedReceipt();
          });
        } else if (runId) {
          turnBuffer.awaitingQueuedHandle = false;
          turnBuffer.runId = runId;
          assistantIdsByRunRef.current.set(runId, assistantId);
          runIdsRef.current.set(assistantId, runId);
          void trackMobileEvent(
            "agent_chat_run_started",
            {
              chat_surface: "mobile",
              thread_id: activeThreadId,
              run_id: runId,
            },
            baseUrlRef.current,
          );
          const runEvents = turnBuffer.earlyRunEvents?.get(runId) ?? [];
          turnBuffer.earlyQueuedEvents = undefined;
          turnBuffer.earlyQueuedRunIds = undefined;
          turnBuffer.earlyRunEvents = undefined;
          for (const event of runEvents) {
            processSessionEvent(session, event, targetBaseUrl, activeThreadId);
          }
        } else {
          turnBuffer.awaitingQueuedHandle = false;
          turnBuffer.earlyQueuedEvents = undefined;
          turnBuffer.earlyQueuedRunIds = undefined;
          turnBuffer.earlyRunEvents = undefined;
          turnBuffer.acceptEvents = false;
          turnBuffer.sawTerminal = true;
        }
        if (!("queuedMessageId" in runHandle)) {
          await runHandle.completed;
        }
        if (activeGenerationRef.current === currentGeneration) {
          buffered = turnBuffer.state;
          if (
            !turnBuffer.sawTerminal &&
            !turnBuffer.sawApproval &&
            !controller.signal.aborted
          ) {
            buffered = applyWireEvent(
              buffered,
              {
                type: "error",
                error:
                  "The connection to the agent dropped before it finished. Retry to continue.",
                errorCode: "stream_dropped",
              },
              assistantId,
            );
          }
          buffered = { ...buffered, isStreaming: false, activity: null };
          turnBuffer.state = buffered;
        }
      } catch (error) {
        reportDispatchResult(false);
        if (activeGenerationRef.current !== currentGeneration) {
          return;
        }
        const aborted = error instanceof Error && error.name === "AbortError";
        if (error instanceof AgentChatError && error.authRequired) {
          if (mountedRef.current) setAuthRequired(true);
        }
        if (error instanceof AgentChatError && error.status === 403) {
          invalidateAgentEngineReadiness(readinessSource);
          void checkChatEligibility(true);
        } else if (error instanceof AgentChatError && error.status === 503) {
          invalidateAgentEngineReadiness(readinessSource);
          void checkChatEligibility(true);
        }
        buffered = turnBuffer.state;
        buffered = aborted
          ? cancelTurnState(buffered, assistantId)
          : {
              ...buffered,
              isStreaming: false,
              activity: null,
              error:
                error instanceof Error ? error.message : "Chat request failed",
              errorCode:
                error instanceof AgentChatError && error.authRequired
                  ? "auth"
                  : error instanceof AgentChatError && error.status === 403
                    ? "missing_api_key"
                    : error instanceof AgentChatError && error.status === 503
                      ? "chat_setup_unavailable"
                      : null,
            };
        turnBuffer.state = buffered;
      } finally {
        reportDispatchResult(false);
        clearInterval(flushTimer);
        if (queuedMessageReservationId) {
          currentAgentKit.cancelQueuedMessageReservation?.(
            activeThreadId,
            queuedMessageReservationId,
          );
        }
        if (activeGenerationRef.current === currentGeneration) {
          if (activeTurnBufferRef.current === turnBuffer) {
            activeTurnBufferRef.current = null;
          }
          liveTurnRef.current = null;
          stateRef.current = turnBuffer.state;
          if (mountedRef.current) setState(turnBuffer.state);
        }
      }
    },
    [
      getSession,
      markThreadEventsSeen,
      processSessionEvent,
      checkChatEligibility,
      readinessSource,
      requireChatEligibility,
      showSetupRequiredError,
    ],
  );

  const send = useCallback(
    (
      text: string,
      attachments?: ChatAttachment[],
      references?: ChatReference[],
    ): Promise<boolean> => {
      const trimmed = text.trim();
      if ((!trimmed && !attachments?.length) || stateRef.current.isStreaming) {
        return Promise.resolve(false);
      }
      pendingForkRetryRef.current = null;
      lastPromptRef.current = trimmed;
      lastExtraRef.current = {
        ...(attachments?.length ? { attachments } : {}),
        ...(references?.length ? { references } : {}),
      };
      return new Promise<boolean>((resolve) => {
        void runTurn(
          trimmed,
          {
            ...(attachments?.length ? { attachments } : {}),
            ...(references?.length ? { references } : {}),
          },
          undefined,
          { onDispatchResult: resolve },
        ).catch(() => resolve(false));
      });
    },
    [runTurn],
  );

  const stop = useCallback(() => {
    const live = liveTurnRef.current;
    if (!live) return;
    live.abort();
    if (live.queued) return;
    const active = activeTurnBufferRef.current;
    if (active) {
      active.state = cancelTurnState(active.state, active.assistantId);
      active.sawTerminal = true;
      active.dirty = true;
      stateRef.current = active.state;
      setState(active.state);
    }
  }, []);

  const resolvePendingApproval = useCallback(
    (approvalKey: string, decision: "approve" | "deny") => {
      const pending = pendingApprovalRef.current;
      if (!pending || pending.approvalId !== approvalKey || pending.resolving) {
        return;
      }
      const currentGeneration = ++activeGenerationRef.current;
      const active = activeTurnBufferRef.current;
      const currentState =
        active?.runId === pending.runId ? active.state : stateRef.current;
      const buffered: ChatTurnState = {
        ...currentState,
        isStreaming: true,
        activity: null,
        error: null,
        errorCode: null,
      };
      const turnBuffer: ActiveTurnBuffer = {
        generation: currentGeneration,
        assistantId: pending.assistantId,
        runId: pending.runId,
        state: buffered,
        dirty: false,
        sawTerminal: false,
        sawApproval: false,
        acceptEvents: true,
      };
      pendingApprovalRef.current = { ...pending, resolving: true };
      activeTurnBufferRef.current = turnBuffer;
      stateRef.current = buffered;
      setState(buffered);
      void trackMobileEvent(
        "agent_chat_turn_started",
        {
          chat_surface: "mobile",
          thread_id: pending.threadId,
          turn_kind: "approval",
          has_attachments: false,
          reference_count: 0,
        },
        baseUrlRef.current,
      );
      liveTurnRef.current = {
        runId: pending.runId,
        abort: () =>
          void pending.session.client.cancelRun(
            pending.threadId,
            turnBuffer.runId ?? pending.runId,
          ),
      };

      const flushTimer = setInterval(() => {
        if (
          !mountedRef.current ||
          activeGenerationRef.current !== currentGeneration
        ) {
          clearInterval(flushTimer);
          return;
        }
        if (turnBuffer.dirty) {
          turnBuffer.dirty = false;
          stateRef.current = turnBuffer.state;
          setState(turnBuffer.state);
        }
        if (activeTurnBufferRef.current !== turnBuffer) {
          clearInterval(flushTimer);
        }
      }, FLUSH_INTERVAL_MS);

      void pending.session.client
        .resolveApproval({
          threadId: pending.threadId,
          runId: pending.runId,
          approvalId: pending.approvalId,
          response: { decision },
        })
        .catch((error: unknown) => {
          if (
            !mountedRef.current ||
            activeGenerationRef.current !== currentGeneration ||
            activeTurnBufferRef.current !== turnBuffer
          ) {
            return;
          }
          if (pendingApprovalRef.current?.approvalId === approvalKey) {
            pendingApprovalRef.current = {
              ...pendingApprovalRef.current,
              resolving: false,
            };
          }
          const failed = {
            ...turnBuffer.state,
            isStreaming: false,
            activity: null,
            error:
              error instanceof Error
                ? error.message
                : "Could not continue after approval.",
            errorCode: null,
          };
          turnBuffer.state = failed;
          stateRef.current = failed;
          setState(failed);
          activeTurnBufferRef.current = null;
          liveTurnRef.current = null;
        });
    },
    [],
  );

  const approve = useCallback(
    (approvalKey: string) => resolvePendingApproval(approvalKey, "approve"),
    [resolvePendingApproval],
  );

  const deny = useCallback(
    (approvalKey?: string) => {
      const pending = pendingApprovalRef.current;
      if (pending && (!approvalKey || pending.approvalId === approvalKey)) {
        resolvePendingApproval(pending.approvalId, "deny");
        return;
      }
      if (!approvalKey || pending?.approvalId === approvalKey) {
        pendingApprovalRef.current = null;
      }
      setState((current) => ({
        ...current,
        messages: current.messages.map((message) => ({
          ...message,
          parts: message.parts.map((part) =>
            part.type === "tool-call" &&
            part.status === "awaiting-approval" &&
            (!approvalKey || part.approvalKey === approvalKey)
              ? { ...part, status: "failed" as const, error: "Denied" }
              : part,
          ),
        })),
      }));
    },
    [resolvePendingApproval],
  );

  const continueAfterConnection = useCallback(
    (requestId: string, provider: string) => {
      const currentThreadId = threadIdRef.current;
      const pending = connectionSessionByRequestRef.current.get(requestId);
      if (pending) {
        const assistant = [...stateRef.current.messages]
          .reverse()
          .find(
            (message) =>
              message.role === "assistant" &&
              message.parts.some(
                (part) =>
                  part.type === "connection-request" && part.id === requestId,
              ),
          );
        if (!assistant) return;
        const currentGeneration = ++activeGenerationRef.current;
        const buffered = {
          ...stateRef.current,
          isStreaming: true,
          activity: "Connecting…",
          error: null,
          errorCode: null,
        };
        const turnBuffer: ActiveTurnBuffer = {
          generation: currentGeneration,
          assistantId: assistant.id,
          runId: pending.runId,
          state: buffered,
          dirty: true,
          sawTerminal: false,
          sawApproval: false,
          acceptEvents: true,
        };
        activeTurnBufferRef.current = turnBuffer;
        stateRef.current = buffered;
        setState(buffered);
        liveTurnRef.current = {
          runId: pending.runId,
          abort: () =>
            void pending?.session.client.cancelRun(
              currentThreadId,
              pending.runId,
            ),
        };
        void pending.session.client
          .resolveConnectionRequest({
            threadId: currentThreadId,
            runId: pending.runId,
            requestId,
            response: { status: "connected" },
          })
          .catch((error: unknown) => {
            if (activeTurnBufferRef.current !== turnBuffer) return;
            const failed = {
              ...turnBuffer.state,
              isStreaming: false,
              activity: null,
              error:
                error instanceof Error
                  ? error.message
                  : `Could not continue after connecting ${provider}.`,
              errorCode: null,
            };
            turnBuffer.state = failed;
            stateRef.current = failed;
            setState(failed);
            activeTurnBufferRef.current = null;
            liveTurnRef.current = null;
          });
        return;
      }
      if (stateRef.current.isStreaming) return;
      const prompt = `I connected ${provider}. Continue with my request.`;
      lastPromptRef.current = prompt;
      void runTurn(prompt);
    },
    [runTurn],
  );

  const invokeWidgetAction = useCallback(
    async (widgetId: string, action: string, payload?: unknown) => {
      await requireChatEligibility().catch((error: unknown) => {
        showSetupRequiredError(error);
        throw error;
      });
      const result = await getSession(baseUrlRef.current).client.invokeAction({
        id: nextLocalId("widget-action"),
        action,
        threadId: threadIdRef.current,
        widgetId,
        ...(payload === undefined ? {} : { payload }),
      });
      if (result.status !== "completed") {
        throw new Error(
          result.error?.message ?? "The action could not be completed.",
        );
      }
    },
    [getSession, requireChatEligibility, showSetupRequiredError],
  );

  const retry = useCallback(() => {
    const pendingFork = pendingForkRetryRef.current;
    if (pendingFork && !stateRef.current.isStreaming) {
      const retryPendingFork = retryPendingForkRef.current;
      if (!retryPendingFork) return;
      void retryPendingFork(pendingFork).catch((error: unknown) => {
        if (error instanceof MobileChatSetupRequiredError) {
          showSetupRequiredError(error);
          return;
        }
        const nextState = {
          ...stateRef.current,
          isStreaming: false,
          activity: null,
          error:
            error instanceof Error
              ? error.message
              : "Could not retry that message.",
          errorCode: null,
        };
        stateRef.current = nextState;
        setState(nextState);
      });
      return;
    }
    const prompt = lastPromptRef.current;
    const extra = lastExtraRef.current;
    if (
      prompt === null ||
      (!prompt.trim() && !extra.attachments?.length) ||
      stateRef.current.isStreaming
    ) {
      return;
    }
    void runTurn(prompt, extra, undefined, {
      forceReadiness: true,
      replaceFailedAttempt: true,
    });
  }, [runTurn, showSetupRequiredError]);

  const newChat = useCallback(
    (nextBaseUrl = DEFAULT_CHAT_BASE_URL) => {
      activeGenerationRef.current++;
      liveTurnRef.current?.abort();
      pendingApprovalRef.current = null;
      const nextThreadId = newThreadId();
      threadIdRef.current = nextThreadId;
      baseUrlRef.current = nextBaseUrl;
      pendingForkRetryRef.current = null;
      void refreshChatEligibility();
      setThreadId(nextThreadId);
      setBaseUrl(nextBaseUrl);
      lastPromptRef.current = null;
      lastExtraRef.current = {};
      setHistoryLoading(false);
      const nextState: ChatTurnState = {
        messages: [],
        activity: null,
        isStreaming: false,
        error: null,
        errorCode: null,
        runId: null,
      };
      stateRef.current = nextState;
      setState(nextState);
    },
    [refreshChatEligibility],
  );

  /**
   * Reattach to a run that is still executing server-side (app was closed or
   * backgrounded mid-turn). Replays the run's events from seq 0 into a fresh
   * assistant message — the persisted history never contains the in-flight
   * assistant reply, so no duplication.
   */
  const resumeRun = useCallback(
    async (
      session: MobileAgentKitSession,
      thread: AgentThreadState,
      runId: string,
      currentGeneration: number,
    ) => {
      const currentThread = session.client.getThread(thread.id);
      const assistantId = nextLocalId("assistant");
      runIdsRef.current.set(assistantId, runId);
      let buffered: ChatTurnState = {
        ...agentKitThreadToMobileTurnState(currentThread),
        isStreaming: true,
        activity: "Resuming…",
        error: null,
        errorCode: null,
        runId,
      };
      const turnBuffer: ActiveTurnBuffer = {
        generation: currentGeneration,
        assistantId,
        runId,
        state: buffered,
        dirty: false,
        sawTerminal: false,
        sawApproval: false,
        acceptEvents: true,
      };
      activeTurnBufferRef.current = turnBuffer;
      stateRef.current = buffered;
      setState(buffered);
      const flushTimer = setInterval(() => {
        if (
          turnBuffer.dirty &&
          mountedRef.current &&
          activeGenerationRef.current === currentGeneration
        ) {
          turnBuffer.dirty = false;
          stateRef.current = turnBuffer.state;
          setState(turnBuffer.state);
        }
      }, FLUSH_INTERVAL_MS);
      try {
        for (const event of currentThread.events
          .filter((item) => item.runId === runId)
          .sort((left, right) => left.sequence - right.sequence)) {
          const wire = mobileAgentKitEventToWireEvent(event);
          if (!wire) continue;
          if (event.type === "approval.requested") {
            pendingApprovalRef.current = {
              approvalId: event.request.id,
              runId,
              assistantId,
              threadId: event.threadId,
              session,
              resolving: false,
            };
            turnBuffer.sawApproval = true;
          }
          if (isTerminalWireEvent(wire)) turnBuffer.sawTerminal = true;
          turnBuffer.state = applyWireEvent(
            turnBuffer.state,
            wire,
            assistantId,
          );
          turnBuffer.dirty = true;
        }
        liveTurnRef.current = {
          abort: () => void session.client.cancelRun(thread.id, runId),
          runId,
        };
        await session.client.resubscribeRun(thread.id, runId);
        if (activeGenerationRef.current === currentGeneration) {
          buffered = turnBuffer.state;
          if (!turnBuffer.sawTerminal && !turnBuffer.sawApproval) {
            buffered = applyWireEvent(
              buffered,
              {
                type: "error",
                error:
                  "The connection to the agent dropped before it finished. Retry to continue.",
                errorCode: "stream_dropped",
              },
              assistantId,
            );
          }
          buffered = { ...buffered, isStreaming: false, activity: null };
          turnBuffer.state = buffered;
        }
      } catch (error) {
        if (activeGenerationRef.current !== currentGeneration) {
          return;
        }
        buffered = turnBuffer.state;
        buffered = {
          ...buffered,
          isStreaming: false,
          activity: null,
          error: error instanceof Error ? error.message : "Failed to resume",
          errorCode: null,
        };
        turnBuffer.state = buffered;
      } finally {
        clearInterval(flushTimer);
        if (activeGenerationRef.current === currentGeneration) {
          if (activeTurnBufferRef.current === turnBuffer) {
            activeTurnBufferRef.current = null;
          }
          liveTurnRef.current = null;
          stateRef.current = turnBuffer.state;
          if (mountedRef.current) setState(buffered);
        }
      }
    },
    [],
  );

  const openThread = useCallback(
    (nextThreadId: string, nextBaseUrl?: string) => {
      const currentGeneration = ++activeGenerationRef.current;
      liveTurnRef.current?.abort();
      pendingApprovalRef.current = null;
      const resolvedBaseUrl = nextBaseUrl ?? DEFAULT_CHAT_BASE_URL;
      // Set synchronously so runTurn/reattach read the right app immediately,
      // before the state update commits.
      baseUrlRef.current = resolvedBaseUrl;
      threadIdRef.current = nextThreadId;
      pendingForkRetryRef.current = null;
      void refreshChatEligibility();
      setBaseUrl(resolvedBaseUrl);
      setThreadId(nextThreadId);
      lastPromptRef.current = null;
      lastExtraRef.current = {};
      setHistoryLoading(true);
      const emptyState: ChatTurnState = {
        messages: [],
        activity: null,
        isStreaming: false,
        error: null,
        errorCode: null,
        runId: null,
      };
      stateRef.current = emptyState;
      setState(emptyState);
      let session = getSession(resolvedBaseUrl);
      session.client
        .loadThread(nextThreadId)
        .then(async (loadedThread) => {
          if (
            !mountedRef.current ||
            activeGenerationRef.current !== currentGeneration
          ) {
            return;
          }
          let thread = loadedThread;
          const chatScope = [...thread.messages]
            .reverse()
            .map((message) => mobileChatScope(message.metadata))
            .find((scope) => scope !== null);
          if (chatScope) {
            const scopedSession = getSession(resolvedBaseUrl, chatScope);
            if (scopedSession !== session) {
              const scopedThread =
                await scopedSession.client.loadThread(nextThreadId);
              if (
                !mountedRef.current ||
                activeGenerationRef.current !== currentGeneration
              ) {
                return;
              }
              session = scopedSession;
              thread = scopedThread;
            }
          }
          markThreadEventsSeen(nextThreadId, thread.events);
          const loadedState = agentKitThreadToMobileTurnState(thread);
          stateRef.current = loadedState;
          setState(loadedState);
          setHistoryLoading(false);
          if (loadedState.runId) {
            void resumeRun(
              session,
              thread,
              loadedState.runId,
              currentGeneration,
            );
          }
        })
        .catch((error) => {
          if (
            !mountedRef.current ||
            activeGenerationRef.current !== currentGeneration
          ) {
            return;
          }
          setHistoryLoading(false);
          if (error instanceof AgentChatError && error.authRequired) {
            setAuthRequired(true);
          } else {
            setState((current) => ({
              ...current,
              error:
                error instanceof Error ? error.message : "Failed to load chat",
              errorCode: null,
            }));
          }
        });
    },
    [getSession, markThreadEventsSeen, refreshChatEligibility, resumeRun],
  );

  // Poll for navigate commands from the agent
  useEffect(() => {
    if (!mountedRef.current) return;
    let active = AppState.currentState === "active";
    let inFlight = false;
    const tick = async () => {
      // Don't poll while streaming, backgrounded, or a previous tick is still in flight
      if (stateRef.current.isStreaming || !active || inFlight) return;
      inFlight = true;
      try {
        // Poll and acknowledge against the active thread's app — a command
        // written by a Dispatch/Content/etc. thread lives on that origin, not
        // the default Chat one.
        const origin = baseUrlRef.current;
        const command = await withPollTimeout(
          fetchNavigateCommand(origin),
          NAVIGATE_POLL_TIMEOUT_MS,
        ).catch((err: unknown) => {
          // A failed or timed-out probe is not "no command pending" — the two
          // are indistinguishable downstream, so say which one happened.
          console.warn("[agent-chat] navigate command poll failed:", err);
          return null;
        });
        if (!command) return;

        const dedupKey = navigateCommandDedupKey(command);
        if (lastProcessedWriteIdRef.current === dedupKey) {
          void deleteNavigateCommand(origin);
          return;
        }
        lastProcessedWriteIdRef.current = dedupKey;
        void deleteNavigateCommand(origin);

        const targetThreadId = extractThreadId(command);
        if (targetThreadId && targetThreadId !== threadId) {
          openThread(targetThreadId, origin);
        }
      } finally {
        inFlight = false;
      }
    };
    const pollInterval = setInterval(
      () => void tick(),
      NAVIGATE_POLL_INTERVAL_MS,
    );
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
    });

    return () => {
      clearInterval(pollInterval);
      subscription.remove();
    };
  }, [threadId, openThread]);

  const getRunId = useCallback((messageId: string) => {
    const message = stateRef.current.messages.find(
      (item) => item.id === messageId,
    );
    return (
      runIdsRef.current.get(messageId) ??
      (message ? messageRunId(message) : null)
    );
  }, []);

  const forkResubmitForMessage = useCallback(
    async (messageId: string, text?: string) => {
      if (stateRef.current.isStreaming) {
        throw new Error("Wait for the current response to finish first.");
      }
      const source = stateRef.current.messages.find(
        (message) => message.id === messageId,
      );
      if (!source) {
        throw new Error(
          "The message is no longer available in this conversation.",
        );
      }
      const prompt = text ?? messageText(source);
      pendingForkRetryRef.current = { messageId, text };
      const targetBaseUrl = baseUrlRef.current;
      const session = getSession(
        targetBaseUrl,
        mobileChatScope(source.metadata) ?? undefined,
      );
      const forkedThread = await forkAndResubmitMobileMessage(
        session.client,
        threadIdRef.current,
        messageId,
        async () => {
          await requireChatEligibility(true).catch((error: unknown) => {
            showSetupRequiredError(error);
            throw error;
          });
        },
        text,
      );
      openThread(forkedThread.id, targetBaseUrl);
      pendingForkRetryRef.current = null;
      lastPromptRef.current = prompt;
      lastExtraRef.current = {};
    },
    [getSession, openThread, requireChatEligibility, showSetupRequiredError],
  );

  const retryPendingFork = useCallback(
    async (pending: { messageId: string; text?: string }) => {
      if (pendingForkRetryInFlightRef.current) return;
      pendingForkRetryInFlightRef.current = true;
      try {
        await forkResubmitForMessage(pending.messageId, pending.text);
      } finally {
        pendingForkRetryInFlightRef.current = false;
      }
    },
    [forkResubmitForMessage],
  );
  retryPendingForkRef.current = retryPendingFork;

  const editMessage = useCallback(
    (messageId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return Promise.reject(new Error("Enter a message to send."));
      }
      return forkResubmitForMessage(messageId, trimmed);
    },
    [forkResubmitForMessage],
  );

  const regenerateMessage = useCallback(
    (messageId: string) => forkResubmitForMessage(messageId),
    [forkResubmitForMessage],
  );

  const submitFeedback = useCallback(
    async (messageId: string, value: "positive" | "negative") => {
      const source = stateRef.current.messages.find(
        (message) => message.id === messageId,
      );
      if (!source) {
        throw new Error(
          "The message is no longer available in this conversation.",
        );
      }
      const session = getSession(
        baseUrlRef.current,
        mobileChatScope(source.metadata) ?? undefined,
      );
      await submitMobileMessageFeedback(
        session.client,
        threadIdRef.current,
        messageId,
        value,
        runIdsRef.current.get(messageId) ?? messageRunId(source),
      );
    },
    [getSession],
  );

  const clearAuthRequired = useCallback(() => setAuthRequired(false), []);

  return {
    threadId,
    baseUrl,
    messages: state.messages,
    isStreaming: state.isStreaming,
    activity: state.activity,
    error: state.error,
    errorCode: state.errorCode,
    authRequired,
    historyLoading,
    chatEligibility,
    canChat: chatEligibility === "eligible",
    send,
    stop,
    approve,
    deny,
    continueAfterConnection,
    invokeWidgetAction,
    editMessage,
    regenerateMessage,
    submitFeedback,
    retry,
    newChat,
    openThread,
    clearAuthRequired,
    refreshChatEligibility: () => void refreshChatEligibility(),
    getRunId,
  };
}

function annotateBufferedAssistantMessage(
  state: ChatTurnState,
  assistantId: string,
  event: AgentEvent,
): ChatTurnState {
  const index = state.messages.findIndex(
    (message) => message.id === assistantId,
  );
  if (index < 0) return state;
  const scope = mobileChatScope(event.metadata);
  const turnId = eventTurnId(event);
  const messages = [...state.messages];
  messages[index] = {
    ...messages[index]!,
    metadata: {
      ...messages[index]!.metadata,
      runId: event.runId,
      ...(turnId ? { turnId } : {}),
      ...(scope ? { chatScope: scope } : {}),
    },
  };
  return { ...state, messages };
}
