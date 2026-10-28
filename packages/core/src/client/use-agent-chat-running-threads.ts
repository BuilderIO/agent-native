import { useCallback, useEffect, useRef, useState } from "react";

import { agentNativePath } from "./api-path.js";
import { usePollLoop } from "./use-poll-loop.js";

export const AGENT_CHAT_RUNNING_EVENT = "agentNative.chatRunning";

export type AgentChatPresentationPhase = "working" | "responding" | "idle";

export interface AgentChatRunningEventDetail {
  isRunning: boolean;
  phase?: AgentChatPresentationPhase;
  threadId?: string;
  tabId?: string;
  turnId?: string;
  runId?: string;
  reason?: string;
}

export interface UseAgentChatRunningThreadsOptions {
  apiUrl?: string;
  pollIntervalMs?: number;
  startGraceMs?: number;
}

export interface AgentChatRunningThreadsState {
  runningThreadIds: ReadonlySet<string>;
  workingThreadIds: ReadonlySet<string>;
  observedThreadStarts: ReadonlyMap<string, number>;
}

export function resolveAgentChatRunningThreadId(
  detail: Partial<AgentChatRunningEventDetail> | null | undefined,
): string | null {
  const value = detail?.threadId ?? detail?.tabId;
  return typeof value === "string" && value.trim() ? value : null;
}

export function dispatchAgentChatRunning(
  detail: AgentChatRunningEventDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENT_CHAT_RUNNING_EVENT, { detail }));
}

export function useAgentChatRunningThreads(
  options: UseAgentChatRunningThreadsOptions = {},
): AgentChatRunningThreadsState {
  const apiUrl = options.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const startGraceMs = options.startGraceMs ?? 3_000;
  const [runningThreadIds, setRunningThreadIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [workingThreadIds, setWorkingThreadIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [observedThreadStarts, setObservedThreadStarts] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const runningRef = useRef(runningThreadIds);
  const observedRef = useRef(observedThreadStarts);
  runningRef.current = runningThreadIds;
  observedRef.current = observedThreadStarts;

  const setRunning = useCallback((threadId: string, running: boolean) => {
    setRunningThreadIds((current) => {
      const hasThread = current.has(threadId);
      if (hasThread === running) return current;
      const next = new Set(current);
      if (running) next.add(threadId);
      else next.delete(threadId);
      return next;
    });
    if (!running) return;
    setObservedThreadStarts((current) => {
      if (current.has(threadId)) return current;
      return new Map(current).set(threadId, Date.now());
    });
  }, []);

  const setWorking = useCallback((threadId: string, working: boolean) => {
    setWorkingThreadIds((current) => {
      const hasThread = current.has(threadId);
      if (hasThread === working) return current;
      const next = new Set(current);
      if (working) next.add(threadId);
      else next.delete(threadId);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleRunning = (event: Event) => {
      const detail = (event as CustomEvent<AgentChatRunningEventDetail>).detail;
      if (typeof detail?.isRunning !== "boolean") return;
      const threadId = resolveAgentChatRunningThreadId(detail);
      if (!threadId) return;
      setRunning(threadId, detail.isRunning);
      setWorking(
        threadId,
        detail.isRunning &&
          detail.phase !== "responding" &&
          detail.phase !== "idle",
      );
    };
    window.addEventListener(AGENT_CHAT_RUNNING_EVENT, handleRunning);
    return () =>
      window.removeEventListener(AGENT_CHAT_RUNNING_EVENT, handleRunning);
  }, [setRunning, setWorking]);

  const verifyRunningThreads = useCallback(
    async (signal: AbortSignal) => {
      const threadIds = [...runningRef.current];
      if (!threadIds.length) return;
      const settled = await Promise.all(
        threadIds.map(async (threadId) => {
          const response = await fetch(
            `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
            { signal },
          );
          if (!response.ok) return null;
          const value = (await response.json()) as unknown;
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
          }
          const active = (value as { active?: unknown }).active;
          return typeof active === "boolean" ? { threadId, active } : null;
        }),
      );
      const now = Date.now();
      for (const result of settled) {
        if (!result || result.active) continue;
        const observedAt = observedRef.current.get(result.threadId) ?? 0;
        if (now - observedAt < startGraceMs) continue;
        setRunning(result.threadId, false);
        setWorking(result.threadId, false);
      }
    },
    [apiUrl, setRunning, setWorking, startGraceMs],
  );

  usePollLoop(verifyRunningThreads, {
    intervalMs: pollIntervalMs,
    enabled: runningThreadIds.size > 0,
    leading: false,
  });

  return { runningThreadIds, workingThreadIds, observedThreadStarts };
}
