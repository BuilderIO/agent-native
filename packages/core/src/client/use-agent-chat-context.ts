import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  clearAgentChatContext,
  filterAgentChatContextItems,
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

export function useAgentChatContext(enabled = true): UseAgentChatContextResult {
  const appStateVersion = useChangeVersion("app-state");
  const state = useSyncExternalStore(
    subscribeAgentChatContext,
    getAgentChatContextState,
    getAgentChatContextState,
  );
  const items = useMemo(
    () => filterAgentChatContextItems(state.items),
    [state.items],
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
  const refresh = useCallback(async () => {
    const refreshed = await refreshAgentChatContext();
    return {
      ...refreshed,
      items: filterAgentChatContextItems(refreshed.items),
    };
  }, []);

  return {
    ...state,
    items,
    set,
    remove,
    clear,
    refresh,
  };
}

export type { AgentChatContextItem };
