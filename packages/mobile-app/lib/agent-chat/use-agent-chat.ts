import type { AgentThreadState } from "@agent-native/agentkit";
import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

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
  fetchMobileChatEligibility,
  fetchNavigateCommand,
  newThreadId,
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
  ) => void;
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
}

interface ActiveTurnBuffer {
  generation: number;
  assistantId: string;
  runId: string | null;
  state: ChatTurnState;
  dirty: boolean;
  sawTerminal: boolean;
  sawApproval: boolean;
  acceptEvents: boolean;
}

interface PendingApproval {
  approvalId: string;
  runId: string;
  assistantId: string;
  threadId: string;
  session: MobileAgentKitSession;
  resolving: boolean;
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
  const [chatEligibility, setChatEligibility] =
    useState<MobileChatEligibility>("checking");

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
  const readinessRequestRef = useRef(0);
  const readinessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readinessRetryCountRef = useRef(0);

  const refreshChatEligibility = useCallback(async () => {
    if (readinessTimerRef.current) clearTimeout(readinessTimerRef.current);
    readinessTimerRef.current = null;
    const requestId = ++readinessRequestRef.current;
    chatEligibilityRef.current = "checking";
    setChatEligibility("checking");
    let nextState: MobileChatEligibility = "unavailable";
    try {
      const eligible = await fetchMobileChatEligibility(baseUrlRef.current);
      nextState = eligible ? "eligible" : "missing";
    } catch (error) {
      if (readinessRequestRef.current !== requestId) return;
      if (error instanceof AgentChatError && error.status === 401) {
        setAuthRequired(true);
      }
    }
    if (readinessRequestRef.current !== requestId) return;
    chatEligibilityRef.current = nextState;
    setChatEligibility(nextState);
    if (nextState === "eligible") {
      readinessRetryCountRef.current = 0;
      if (stateRef.current.errorCode === "missing_api_key") {
        const recovered = {
          ...stateRef.current,
          error: null,
          errorCode: null,
        };
        stateRef.current = recovered;
        setState(recovered);
      }
    } else {
      readinessRetryCountRef.current += 1;
    }
    const delay =
      nextState === "eligible"
        ? 30_000
        : Math.min(
            2_000 * 2 ** Math.min(readinessRetryCountRef.current, 4),
            30_000,
          );
    readinessTimerRef.current = setTimeout(
      () => void refreshChatEligibility(),
      delay,
    );
  }, []);

  useEffect(() => {
    void refreshChatEligibility();
    return () => {
      readinessRequestRef.current += 1;
      if (readinessTimerRef.current) clearTimeout(readinessTimerRef.current);
      readinessTimerRef.current = null;
    };
  }, [baseUrl, refreshChatEligibility]);

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
          const active = activeTurnBufferRef.current;
          if (
            !active ||
            !active.acceptEvents ||
            active.generation !== activeGenerationRef.current
          ) {
            continue;
          }
          const pendingApproval = pendingApprovalRef.current;
          if (active.runId && active.runId !== event.runId) {
            const resumedApproval =
              event.type === "approval.resolved" &&
              pendingApproval?.resolving &&
              pendingApproval.runId === active.runId &&
              pendingApproval.approvalId === event.approvalId;
            if (!resumedApproval) continue;
            pendingApprovalRef.current = null;
          } else if (
            event.type === "approval.resolved" &&
            pendingApproval?.resolving &&
            pendingApproval.runId === event.runId &&
            pendingApproval.approvalId === event.approvalId
          ) {
            pendingApprovalRef.current = null;
          }
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
          if (!wireEvent) continue;
          const scopeValue = mobileChatScope(event.metadata);
          const wire = scopeValue
            ? { ...wireEvent, scope: scopeValue }
            : wireEvent;
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
            chatEligibilityRef.current = "missing";
            setChatEligibility("missing");
          }
          if (isTerminalWireEvent(wire)) active.sawTerminal = true;
          active.state = annotateAssistantMessage(
            applyWireEvent(active.state, wire, active.assistantId),
            active.assistantId,
            event,
          );
          active.dirty = true;
          if (
            wire.type !== "connection_required" &&
            isTerminalWireEvent(wire)
          ) {
            activeTurnBufferRef.current = null;
            liveTurnRef.current = null;
          }
        }
      });
      sessionsRef.current.set(sessionKey, session);
      return session;
    },
    [],
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
    ) => {
      if (chatEligibilityRef.current !== "eligible") return;
      lastPromptRef.current = text;
      lastExtraRef.current = extra;
      const currentGeneration = ++activeGenerationRef.current;
      const activeThreadId = currentThreadId ?? threadIdRef.current;
      const targetBaseUrl = baseUrlRef.current;
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

      try {
        const controller = new AbortController();
        liveTurnRef.current = { abort: () => controller.abort(), runId: null };

        let loaded = await currentAgentKit.loadThread(activeThreadId, {
          signal: controller.signal,
        });
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
          if (activeGenerationRef.current !== currentGeneration) return;
        }
        markThreadEventsSeen(activeThreadId, loaded.events);
        turnBuffer.acceptEvents = true;
        const durableAttachments = await uploadMobileChatAttachments(
          currentAgentKit,
          activeThreadId,
          extra.attachments,
        );
        const details = durableAttachments.map(
          ({ type, name, contentType, url }) => ({
            type,
            name,
            ...(contentType ? { contentType } : {}),
            url,
          }),
        );
        const runHandle = await currentAgentKit.sendMessage(
          {
            threadId: activeThreadId,
            text,
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

        if (activeGenerationRef.current !== currentGeneration) {
          return;
        }

        liveTurnRef.current = {
          abort: () => {
            controller.abort();
            void currentAgentKit.cancelRun(activeThreadId, runHandle.runId);
          },
          runId: runHandle.runId,
        };
        turnBuffer.runId = runHandle.runId;
        assistantIdsByRunRef.current.set(runHandle.runId, assistantId);
        runIdsRef.current.set(assistantId, runHandle.runId);
        void trackMobileEvent(
          "agent_chat_run_started",
          {
            chat_surface: "mobile",
            thread_id: activeThreadId,
            run_id: runHandle.runId,
          },
          baseUrlRef.current,
        );
        await runHandle.completed;
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
        if (activeGenerationRef.current !== currentGeneration) {
          return;
        }
        const aborted = error instanceof Error && error.name === "AbortError";
        if (error instanceof AgentChatError && error.authRequired) {
          if (mountedRef.current) setAuthRequired(true);
        }
        if (error instanceof AgentChatError && error.status === 403) {
          chatEligibilityRef.current = "missing";
          setChatEligibility("missing");
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
                    : null,
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
          if (mountedRef.current) setState(turnBuffer.state);
        }
      }
    },
    [getSession, markThreadEventsSeen],
  );

  const send = useCallback(
    (
      text: string,
      attachments?: ChatAttachment[],
      references?: ChatReference[],
    ) => {
      const trimmed = text.trim();
      if ((!trimmed && !attachments?.length) || stateRef.current.isStreaming) {
        return;
      }
      lastPromptRef.current = trimmed;
      lastExtraRef.current = {
        ...(attachments?.length ? { attachments } : {}),
        ...(references?.length ? { references } : {}),
      };
      void runTurn(trimmed, {
        ...(attachments?.length ? { attachments } : {}),
        ...(references?.length ? { references } : {}),
      });
    },
    [runTurn],
  );

  const stop = useCallback(() => {
    const live = liveTurnRef.current;
    if (!live) return;
    live.abort();
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
      if (chatEligibilityRef.current !== "eligible") return;
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
      if (chatEligibilityRef.current !== "eligible") {
        throw new Error("Connect an AI provider before using chat actions.");
      }
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
    [getSession],
  );

  const retry = useCallback(() => {
    const prompt = lastPromptRef.current;
    const extra = lastExtraRef.current;
    if (
      prompt === null ||
      (!prompt.trim() && !extra.attachments?.length) ||
      stateRef.current.isStreaming
    ) {
      return;
    }
    setState((current) => {
      const messages = [...current.messages];
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") messages.pop();
      const secondLast = messages[messages.length - 1];
      if (
        secondLast?.role === "user" &&
        messageText(secondLast).trim() === prompt
      ) {
        messages.pop();
      }
      return { ...current, messages, error: null, errorCode: null };
    });
    // Let the removal state land before re-sending so history is correct.
    setTimeout(() => void runTurn(prompt, extra), 0);
  }, [runTurn]);

  const newChat = useCallback(
    (nextBaseUrl = DEFAULT_CHAT_BASE_URL) => {
      activeGenerationRef.current++;
      liveTurnRef.current?.abort();
      pendingApprovalRef.current = null;
      const nextThreadId = newThreadId();
      threadIdRef.current = nextThreadId;
      baseUrlRef.current = nextBaseUrl;
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
      if (chatEligibilityRef.current !== "eligible") {
        throw new Error("Connect an AI provider before resending a message.");
      }
      const source = stateRef.current.messages.find(
        (message) => message.id === messageId,
      );
      if (!source) {
        throw new Error(
          "The message is no longer available in this conversation.",
        );
      }
      const targetBaseUrl = baseUrlRef.current;
      const session = getSession(
        targetBaseUrl,
        mobileChatScope(source.metadata) ?? undefined,
      );
      const forkedThread = await forkAndResubmitMobileMessage(
        session.client,
        threadIdRef.current,
        messageId,
        text,
      );
      openThread(forkedThread.id, targetBaseUrl);
      lastPromptRef.current = text ?? messageText(source);
      lastExtraRef.current = {};
    },
    [getSession, openThread],
  );

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
