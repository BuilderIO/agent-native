import { useCallback, useEffect, useRef, useState } from "react";

import {
  abortRun,
  AgentChatError,
  DEFAULT_CHAT_BASE_URL,
  deleteNavigateCommand,
  fetchNavigateCommand,
  fetchThreadMessages,
  getActiveRun,
  newThreadId,
  resumeRunEvents,
  sendChatTurn,
} from "./api";
import { extractThreadId, navigateCommandDedupKey } from "./navigate-command";
import { applyWireEvent, cancelTurnState, nextLocalId } from "./reducer";
import { reattachDroppedRun } from "./run-reattach";
import type {
  ChatAttachment,
  ChatMessage,
  ChatReference,
  ChatSendOptions,
  ChatTurnState,
  WireEvent,
} from "./types";
import { isTerminalWireEvent, messageText } from "./types";

/**
 * Renders are throttled: wire deltas can arrive dozens of times per second,
 * so events fold into a mutable state buffer and flush to React on an
 * interval. Scroll/entering animations run on the UI thread regardless.
 */
const FLUSH_INTERVAL_MS = 50;

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
  send: (
    text: string,
    attachments?: ChatAttachment[],
    references?: ChatReference[],
  ) => void;
  stop: () => void;
  approve: (approvalKey: string) => void;
  deny: (approvalKey?: string) => void;
  retry: () => void;
  newChat: () => void;
  /** Open a thread; pass its origin app base URL for cross-app threads. */
  openThread: (threadId: string, baseUrl?: string) => void;
  clearAuthRequired: () => void;
  /** Run id of the turn that produced this assistant message, if known. */
  getRunId: (messageId: string) => string | null;
}

interface LiveTurn {
  abort: () => void;
  runId: string | null;
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

  const stateRef = useRef(state);
  stateRef.current = state;
  // Async turn/resume closures read the live value, not the render-time one.
  const baseUrlRef = useRef(baseUrl);
  baseUrlRef.current = baseUrl;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const liveTurnRef = useRef<LiveTurn | null>(null);
  const mountedRef = useRef(true);
  const lastPromptRef = useRef<string | null>(null);
  const runIdsRef = useRef(new Map<string, string>());
  const activeGenerationRef = useRef(0);
  const lastProcessedWriteIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      liveTurnRef.current?.abort();
    };
  }, []);

  const runTurn = useCallback(
    async (
      text: string,
      extra: Pick<
        ChatSendOptions & { approvedToolCalls?: string[] },
        "approvedToolCalls" | "attachments" | "references"
      > = {},
      currentThreadId?: string,
    ) => {
      const currentGeneration = ++activeGenerationRef.current;
      const activeThreadId = currentThreadId ?? threadId;
      const committed = stateRef.current.messages;
      const history = committed
        .map((message) => ({
          role: message.role,
          content: messageText(message),
        }))
        .filter((entry) => entry.content.trim().length > 0);

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
      setState(buffered);

      let dirty = false;
      const flushTimer = setInterval(() => {
        if (
          dirty &&
          mountedRef.current &&
          activeGenerationRef.current === currentGeneration
        ) {
          dirty = false;
          setState(buffered);
        }
      }, FLUSH_INTERVAL_MS);

      try {
        const controller = new AbortController();
        liveTurnRef.current = { abort: () => controller.abort(), runId: null };

        const turn = await sendChatTurn(
          text,
          {
            threadId: activeThreadId,
            history,
            model: settingsRef.current.model,
            engine: settingsRef.current.engine,
            effort: settingsRef.current.effort,
            mode: settingsRef.current.mode,
            signal: controller.signal,
            ...(extra.attachments?.length
              ? { attachments: extra.attachments }
              : {}),
            ...(extra.references?.length
              ? { references: extra.references }
              : {}),
            ...(extra.approvedToolCalls
              ? { approvedToolCalls: extra.approvedToolCalls }
              : {}),
          },
          baseUrlRef.current,
        );

        if (activeGenerationRef.current !== currentGeneration) {
          return;
        }

        liveTurnRef.current = {
          abort: () => {
            controller.abort();
            turn.abort();
          },
          runId: turn.runId,
        };

        if (turn.runId) runIdsRef.current.set(assistantId, turn.runId);
        buffered = { ...buffered, runId: turn.runId };
        dirty = true;

        let sawTerminal = false;
        let lastSeq = -1;
        const applyEvent = (event: WireEvent) => {
          if (typeof event.seq === "number") lastSeq = event.seq;
          if (isTerminalWireEvent(event)) sawTerminal = true;
          buffered = applyWireEvent(buffered, event, assistantId);
          dirty = true;
        };

        for await (const event of turn.events) {
          if (activeGenerationRef.current !== currentGeneration) {
            break;
          }
          applyEvent(event);
        }

        // The server always closes a finished run with a terminal event. A
        // stream that just stopped was dropped mid-run — reattach instead of
        // presenting the truncated turn as finished with no feedback.
        if (
          !sawTerminal &&
          turn.runId &&
          !controller.signal.aborted &&
          activeGenerationRef.current === currentGeneration
        ) {
          const result = await reattachDroppedRun({
            runId: turn.runId,
            lastSeq,
            signal: controller.signal,
            apply: applyEvent,
            resume: (runId, after, signal) =>
              resumeRunEvents(runId, after, signal, baseUrlRef.current),
          });
          sawTerminal = result.sawTerminal;
        }

        if (activeGenerationRef.current === currentGeneration) {
          if (!sawTerminal && !controller.signal.aborted) {
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
        }
      } catch (error) {
        if (activeGenerationRef.current !== currentGeneration) {
          return;
        }
        const aborted = error instanceof Error && error.name === "AbortError";
        if (error instanceof AgentChatError && error.authRequired) {
          if (mountedRef.current) setAuthRequired(true);
        }
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
                  : null,
            };
      } finally {
        clearInterval(flushTimer);
        if (activeGenerationRef.current === currentGeneration) {
          liveTurnRef.current = null;
          if (mountedRef.current) setState(buffered);
        }
      }
    },
    [threadId],
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
    if (live.runId) void abortRun(live.runId, baseUrlRef.current);
  }, []);

  const approve = useCallback(
    (approvalKey: string) => {
      if (stateRef.current.isStreaming) return;
      void runTurn("Approved. Go ahead and run the requested action.", {
        approvedToolCalls: [approvalKey],
      });
    },
    [runTurn],
  );

  const deny = useCallback((approvalKey?: string) => {
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
  }, []);

  const retry = useCallback(() => {
    const prompt = lastPromptRef.current;
    if (!prompt || stateRef.current.isStreaming) return;
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
    setTimeout(() => void runTurn(prompt), 0);
  }, [runTurn]);

  const newChat = useCallback(() => {
    activeGenerationRef.current++;
    liveTurnRef.current?.abort();
    setThreadId(newThreadId());
    // New chats always start on the chat app.
    setBaseUrl(DEFAULT_CHAT_BASE_URL);
    lastPromptRef.current = null;
    setState({
      messages: [],
      activity: null,
      isStreaming: false,
      error: null,
      errorCode: null,
      runId: null,
    });
  }, []);

  /**
   * Reattach to a run that is still executing server-side (app was closed or
   * backgrounded mid-turn). Replays the run's events from seq 0 into a fresh
   * assistant message — the persisted history never contains the in-flight
   * assistant reply, so no duplication.
   */
  const resumeRun = useCallback(
    async (runId: string, currentGeneration: number) => {
      const assistantId = nextLocalId("assistant");
      runIdsRef.current.set(assistantId, runId);
      let buffered: ChatTurnState = {
        ...stateRef.current,
        isStreaming: true,
        activity: "Resuming…",
        error: null,
        errorCode: null,
        runId,
      };
      setState(buffered);
      let dirty = false;
      const flushTimer = setInterval(() => {
        if (
          dirty &&
          mountedRef.current &&
          activeGenerationRef.current === currentGeneration
        ) {
          dirty = false;
          setState(buffered);
        }
      }, FLUSH_INTERVAL_MS);
      try {
        const controller = new AbortController();
        liveTurnRef.current = { abort: () => controller.abort(), runId };

        const stream = await resumeRunEvents(
          runId,
          0,
          controller.signal,
          baseUrlRef.current,
        );
        if (activeGenerationRef.current !== currentGeneration) {
          return;
        }

        liveTurnRef.current = {
          abort: () => {
            controller.abort();
            stream.abort();
          },
          runId,
        };

        let sawTerminal = false;
        let lastSeq = -1;
        const applyEvent = (event: WireEvent) => {
          if (typeof event.seq === "number") lastSeq = event.seq;
          if (isTerminalWireEvent(event)) sawTerminal = true;
          buffered = applyWireEvent(buffered, event, assistantId);
          dirty = true;
        };

        for await (const event of stream.events) {
          if (activeGenerationRef.current !== currentGeneration) {
            break;
          }
          applyEvent(event);
        }

        if (
          !sawTerminal &&
          !controller.signal.aborted &&
          activeGenerationRef.current === currentGeneration
        ) {
          const result = await reattachDroppedRun({
            runId,
            lastSeq,
            signal: controller.signal,
            apply: applyEvent,
            resume: (id, after, signal) =>
              resumeRunEvents(id, after, signal, baseUrlRef.current),
          });
          sawTerminal = result.sawTerminal;
        }

        if (activeGenerationRef.current === currentGeneration) {
          if (!sawTerminal && !controller.signal.aborted) {
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
        }
      } catch (error) {
        if (activeGenerationRef.current !== currentGeneration) {
          return;
        }
        const aborted = error instanceof Error && error.name === "AbortError";
        buffered = aborted
          ? cancelTurnState(buffered, assistantId)
          : {
              ...buffered,
              isStreaming: false,
              activity: null,
              error:
                error instanceof Error ? error.message : "Failed to resume",
              errorCode: null,
            };
      } finally {
        clearInterval(flushTimer);
        if (activeGenerationRef.current === currentGeneration) {
          liveTurnRef.current = null;
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
      const resolvedBaseUrl = nextBaseUrl ?? DEFAULT_CHAT_BASE_URL;
      // Set synchronously so runTurn/reattach read the right app immediately,
      // before the state update commits.
      baseUrlRef.current = resolvedBaseUrl;
      setBaseUrl(resolvedBaseUrl);
      setThreadId(nextThreadId);
      lastPromptRef.current = null;
      setHistoryLoading(true);
      setState({
        messages: [],
        activity: null,
        isStreaming: false,
        error: null,
        errorCode: null,
        runId: null,
      });
      Promise.all([
        fetchThreadMessages(nextThreadId, resolvedBaseUrl),
        getActiveRun(nextThreadId, resolvedBaseUrl).catch(() => ({
          active: false as const,
        })),
      ])
        .then(([messages, activeRun]) => {
          if (
            !mountedRef.current ||
            activeGenerationRef.current !== currentGeneration
          ) {
            return;
          }
          setState((current) => ({ ...current, messages }));
          setHistoryLoading(false);
          if (activeRun.active && activeRun.runId) {
            void resumeRun(activeRun.runId, currentGeneration);
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
    [resumeRun],
  );

  // Poll for navigate commands from the agent
  useEffect(() => {
    if (!mountedRef.current) return;
    const pollInterval = setInterval(async () => {
      // Don't poll while streaming
      if (stateRef.current.isStreaming) return;

      const command = await fetchNavigateCommand();
      if (!command) return;

      const dedupKey = navigateCommandDedupKey(command);
      if (lastProcessedWriteIdRef.current === dedupKey) {
        void deleteNavigateCommand();
        return;
      }
      lastProcessedWriteIdRef.current = dedupKey;
      void deleteNavigateCommand();

      const targetThreadId = extractThreadId(command);
      if (targetThreadId && targetThreadId !== threadId) {
        openThread(targetThreadId);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [threadId, openThread]);

  const getRunId = useCallback(
    (messageId: string) => runIdsRef.current.get(messageId) ?? null,
    [],
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
    send,
    stop,
    approve,
    deny,
    retry,
    newChat,
    openThread,
    clearAuthRequired,
    getRunId,
  };
}
