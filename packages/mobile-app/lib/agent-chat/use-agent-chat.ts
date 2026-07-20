import { useCallback, useEffect, useRef, useState } from "react";

import {
  abortRun,
  AgentChatError,
  fetchThreadMessages,
  getActiveRun,
  newThreadId,
  resumeRunEvents,
  sendChatTurn,
} from "./api";
import { applyWireEvent, cancelTurnState, nextLocalId } from "./reducer";
import type {
  ChatAttachment,
  ChatMessage,
  ChatSendOptions,
  ChatTurnState,
} from "./types";
import { messageText } from "./types";

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
  messages: ChatMessage[];
  isStreaming: boolean;
  activity: string | null;
  error: string | null;
  errorCode: string | null;
  authRequired: boolean;
  historyLoading: boolean;
  send: (text: string, attachments?: ChatAttachment[]) => void;
  stop: () => void;
  approve: (approvalKey: string) => void;
  deny: () => void;
  retry: () => void;
  newChat: () => void;
  openThread: (threadId: string) => void;
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

  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const liveTurnRef = useRef<LiveTurn | null>(null);
  const mountedRef = useRef(true);
  const lastPromptRef = useRef<string | null>(null);
  const runIdsRef = useRef(new Map<string, string>());

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
        "approvedToolCalls" | "attachments"
      > = {},
      currentThreadId?: string,
    ) => {
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
        if (dirty && mountedRef.current) {
          dirty = false;
          setState(buffered);
        }
      }, FLUSH_INTERVAL_MS);

      try {
        const turn = await sendChatTurn(text, {
          threadId: activeThreadId,
          history,
          model: settingsRef.current.model,
          engine: settingsRef.current.engine,
          effort: settingsRef.current.effort,
          mode: settingsRef.current.mode,
          ...(extra.attachments?.length
            ? { attachments: extra.attachments }
            : {}),
          ...(extra.approvedToolCalls
            ? { approvedToolCalls: extra.approvedToolCalls }
            : {}),
        });
        liveTurnRef.current = { abort: turn.abort, runId: turn.runId };
        if (turn.runId) runIdsRef.current.set(assistantId, turn.runId);
        buffered = { ...buffered, runId: turn.runId };
        dirty = true;

        for await (const event of turn.events) {
          buffered = applyWireEvent(buffered, event, assistantId);
          dirty = true;
        }
        buffered = { ...buffered, isStreaming: false, activity: null };
      } catch (error) {
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
        liveTurnRef.current = null;
        if (mountedRef.current) setState(buffered);
      }
    },
    [threadId],
  );

  const send = useCallback(
    (text: string, attachments?: ChatAttachment[]) => {
      const trimmed = text.trim();
      if ((!trimmed && !attachments?.length) || stateRef.current.isStreaming) {
        return;
      }
      lastPromptRef.current = trimmed;
      void runTurn(trimmed, attachments?.length ? { attachments } : {});
    },
    [runTurn],
  );

  const stop = useCallback(() => {
    const live = liveTurnRef.current;
    if (!live) return;
    live.abort();
    if (live.runId) void abortRun(live.runId);
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

  const deny = useCallback(() => {
    setState((current) => ({
      ...current,
      messages: current.messages.map((message) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.type === "tool-call" && part.status === "awaiting-approval"
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
    liveTurnRef.current?.abort();
    setThreadId(newThreadId());
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
  const resumeRun = useCallback(async (runId: string) => {
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
      if (dirty && mountedRef.current) {
        dirty = false;
        setState(buffered);
      }
    }, FLUSH_INTERVAL_MS);
    try {
      const stream = await resumeRunEvents(runId, 0);
      liveTurnRef.current = { abort: stream.abort, runId };
      for await (const event of stream.events) {
        buffered = applyWireEvent(buffered, event, assistantId);
        dirty = true;
      }
      buffered = { ...buffered, isStreaming: false, activity: null };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      buffered = aborted
        ? cancelTurnState(buffered, assistantId)
        : {
            ...buffered,
            isStreaming: false,
            activity: null,
            error: error instanceof Error ? error.message : "Failed to resume",
            errorCode: null,
          };
    } finally {
      clearInterval(flushTimer);
      liveTurnRef.current = null;
      if (mountedRef.current) setState(buffered);
    }
  }, []);

  const openThread = useCallback(
    (nextThreadId: string) => {
      liveTurnRef.current?.abort();
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
        fetchThreadMessages(nextThreadId),
        getActiveRun(nextThreadId).catch(() => ({ active: false as const })),
      ])
        .then(([messages, activeRun]) => {
          if (!mountedRef.current) return;
          setState((current) => ({ ...current, messages }));
          setHistoryLoading(false);
          if (activeRun.active && activeRun.runId) {
            void resumeRun(activeRun.runId);
          }
        })
        .catch((error) => {
          if (!mountedRef.current) return;
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

  const getRunId = useCallback(
    (messageId: string) => runIdsRef.current.get(messageId) ?? null,
    [],
  );

  const clearAuthRequired = useCallback(() => setAuthRequired(false), []);

  return {
    threadId,
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
