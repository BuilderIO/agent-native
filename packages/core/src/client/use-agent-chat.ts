import { useState, useEffect, useCallback, useRef } from "react";

import {
  AGENT_CHAT_SUBMIT_TARGET_EVENT,
  generateAgentChatSubmitMessageId,
  sendToAgentChat,
  type AgentChatMessage,
  type AgentChatSubmitTarget,
} from "./agent-chat.js";

const MAX_PENDING_SCOPED_TAB_STATES = 100;

/**
 * Hook that wraps sendToAgentChat with a loading state.
 *
 * Returns [isGenerating, send, stopReason] where:
 * - isGenerating: true after send() is called, false when the
 *   agentNative.chatRunning event reports that the run has stopped
 * - send: wrapper around sendToAgentChat that sets isGenerating to true
 * - stopReason: "stopped" when the user explicitly stopped the run
 * - observedRun: true once the scoped tab reports a run; resets when its ID changes
 * - tabId scope: observe only that tab; null waits until its identity is known
 */
export function useAgentChatGenerating(options?: {
  tabId?: string | null;
}): [boolean, (opts: AgentChatMessage) => string, "stopped" | null, boolean] {
  const [isGenerating, setIsGenerating] = useState(false);
  const [stopReason, setStopReason] = useState<"stopped" | null>(null);
  const [observedRun, setObservedRun] = useState(false);
  const hasTabScope = options !== undefined;
  const hasTabScopeRef = useRef(hasTabScope);
  hasTabScopeRef.current = hasTabScope;
  const scopedTabId = options?.tabId ?? null;
  const scopedTabIdRef = useRef(scopedTabId);
  scopedTabIdRef.current = scopedTabId;
  const activeTabRef = useRef<string | null>(scopedTabId);
  const activeSubmitRef = useRef<string | null>(null);
  const pendingScopedTabStatesRef = useRef(
    new Map<
      string,
      { isRunning: boolean; stopReason: "stopped" | null; observedRun: boolean }
    >(),
  );

  useEffect(() => {
    if (!hasTabScope) {
      pendingScopedTabStatesRef.current.clear();
      setObservedRun(false);
      return;
    }
    activeTabRef.current = scopedTabId;
    activeSubmitRef.current = null;
    const pendingState = scopedTabId
      ? pendingScopedTabStatesRef.current.get(scopedTabId)
      : undefined;
    pendingScopedTabStatesRef.current.clear();
    setIsGenerating(pendingState?.isRunning ?? false);
    setStopReason(pendingState?.stopReason ?? null);
    setObservedRun(pendingState?.observedRun ?? false);
  }, [hasTabScope, scopedTabId]);

  useEffect(() => {
    const targetHandler = (e: Event) => {
      const detail = (e as CustomEvent<AgentChatSubmitTarget>).detail;
      if (
        !detail ||
        detail.submitMessageId !== activeSubmitRef.current ||
        !detail.tabId
      ) {
        return;
      }
      if (hasTabScopeRef.current && detail.tabId !== scopedTabIdRef.current) {
        return;
      }
      activeTabRef.current = detail.tabId;
    };
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.isRunning !== "boolean") return;
      // Only honor events for the run this hook started. Events carrying a
      // different tabId belong to another chat surface (sidebar, other
      // composer, automation) and must not flip our state. Once a run has a
      // tab identity, an unscoped event is just as unrelated as another tab.
      const eventTabId = typeof detail.tabId === "string" ? detail.tabId : null;
      const nextState = {
        isRunning: detail.isRunning,
        stopReason:
          !detail.isRunning && detail.reason === "stopped" ? "stopped" : null,
        observedRun: detail.isRunning,
      } as const;
      const retainPendingState = (tabId: string) => {
        const previousState = pendingScopedTabStatesRef.current.get(tabId);
        pendingScopedTabStatesRef.current.delete(tabId);
        pendingScopedTabStatesRef.current.set(tabId, {
          ...nextState,
          observedRun:
            nextState.observedRun || previousState?.observedRun === true,
        });
        if (
          pendingScopedTabStatesRef.current.size > MAX_PENDING_SCOPED_TAB_STATES
        ) {
          const oldestTabId = pendingScopedTabStatesRef.current
            .keys()
            .next().value;
          if (oldestTabId !== undefined) {
            pendingScopedTabStatesRef.current.delete(oldestTabId);
          }
        }
      };
      if (hasTabScopeRef.current) {
        const scopedTabId = scopedTabIdRef.current;
        if (!scopedTabId) {
          if (eventTabId) retainPendingState(eventTabId);
          return;
        }
        if (eventTabId !== scopedTabId) return;
        if (activeTabRef.current !== scopedTabId && eventTabId) {
          retainPendingState(eventTabId);
        }
      }
      if (!hasTabScopeRef.current && activeTabRef.current && !eventTabId) {
        return;
      }
      if (
        eventTabId &&
        activeTabRef.current &&
        eventTabId !== activeTabRef.current
      ) {
        return;
      }
      setStopReason(nextState.stopReason);
      if (hasTabScopeRef.current && nextState.isRunning) {
        setObservedRun(true);
      }
      if (
        !hasTabScopeRef.current &&
        !detail.isRunning &&
        eventTabId === activeTabRef.current
      ) {
        activeTabRef.current = null;
        activeSubmitRef.current = null;
      }
      setIsGenerating(nextState.isRunning);
    };
    window.addEventListener(
      AGENT_CHAT_SUBMIT_TARGET_EVENT,
      targetHandler as EventListener,
    );
    window.addEventListener("agentNative.chatRunning", handler);
    return () => {
      window.removeEventListener(
        AGENT_CHAT_SUBMIT_TARGET_EVENT,
        targetHandler as EventListener,
      );
      window.removeEventListener("agentNative.chatRunning", handler);
    };
  }, []);

  const send = useCallback((opts: AgentChatMessage): string => {
    const submitMessageId =
      opts.submitMessageId ?? generateAgentChatSubmitMessageId();
    activeSubmitRef.current = submitMessageId;
    const tabId = sendToAgentChat({ ...opts, submitMessageId });
    if (!hasTabScopeRef.current) activeTabRef.current = tabId;
    setStopReason(null);
    setIsGenerating(true);
    return tabId;
  }, []);

  return [isGenerating, send, stopReason, observedRun];
}
