import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  clearAgentChatContext,
  getAgentChatContextState,
  refreshAgentChatContext,
  removeAgentChatContextItem,
  setAgentChatContextItem,
  subscribeAgentChatContext,
  type AgentChatContextItem,
  type AgentChatContextMutationOptions,
  type AgentChatContextSetOptions,
  type AgentChatContextState,
} from "./agent-chat.js";
import { useChangeVersion } from "./use-change-version.js";

export interface UseAgentChatContextResult extends AgentChatContextState {
  set(item: AgentChatContextSetOptions): void;
  remove(key: string): void;
  clear(options?: AgentChatContextMutationOptions): void;
  refresh(): Promise<AgentChatContextState>;
}

/**
 * Advanced hook for UIs that need to stay in sync with the active chat
 * composer's staged context chips. Simple send/prefill flows should use
 * `sendToAgentChat({ message, context, submit })` directly.
 */
export function useAgentChatContext(enabled = true): UseAgentChatContextResult {
  const appStateVersion = useChangeVersion("app-state");
  const state = useSyncExternalStore(
    subscribeAgentChatContext,
    getAgentChatContextState,
    getAgentChatContextState,
  );

  useEffect(() => {
    if (!enabled) return;
    void refreshAgentChatContext();
  }, [appStateVersion, enabled]);

  const set = useCallback((item: AgentChatContextSetOptions) => {
    setAgentChatContextItem(item);
  }, []);

  const remove = useCallback((key: string) => {
    removeAgentChatContextItem(key);
  }, []);

  const clear = useCallback((options?: AgentChatContextMutationOptions) => {
    clearAgentChatContext(options);
  }, []);

  return {
    ...state,
    set,
    remove,
    clear,
    refresh: refreshAgentChatContext,
  };
}

export type { AgentChatContextItem };
