import {
  agentSelectionContextKey,
  getAgentChatContextState,
  subscribeAgentChatContext,
} from "@agent-native/core/client/agent-chat";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import {
  getAgentSelectSnapshot,
  registerAgentSelectable,
  registerAgentSelectableSource,
  subscribeAgentSelect,
  type AgentSelectable,
  type AgentSelectSnapshot,
} from "./agent-select.js";

export interface UseAgentSelectableOptions {
  kind: string;
  id: string;
  title: string;
  getContext(): string;
  getElement(): Element | readonly Element[] | null;
}

/**
 * Register an on-screen object with the composer's Select mode while the
 * component is mounted. Pass `null` to leave it unregistered. Returns whether
 * the object is currently picked.
 */
export function useAgentSelectable(
  options: UseAgentSelectableOptions | null,
): boolean {
  const latest = useRef(options);
  latest.current = options;
  const kind = options?.kind;
  const id = options?.id;

  useEffect(() => {
    if (!kind || !id) return;
    return registerAgentSelectable({
      kind,
      id,
      get title() {
        return latest.current?.title ?? id;
      },
      getContext: () => {
        if (!latest.current) {
          throw new Error(`Selectable ${kind}:${id} is no longer mounted.`);
        }
        return latest.current.getContext();
      },
      getElement: () => latest.current?.getElement() ?? null,
    });
  }, [kind, id]);

  return useAgentSelectableSelected(kind, id);
}

/**
 * Offer dynamic content to Select mode while mounted: `resolve` maps the
 * deepest element under the pointer to an object, or null. Pass `null` to
 * offer nothing.
 */
export function useAgentSelectableSource(
  resolve: ((target: Element) => AgentSelectable | null) | null,
): void {
  const latest = useRef(resolve);
  latest.current = resolve;
  const enabled = resolve !== null;
  useEffect(() => {
    if (!enabled) return;
    return registerAgentSelectableSource({
      resolve: (target) => latest.current?.(target) ?? null,
    });
  }, [enabled]);
}

/** Whether `kind`/`id` is picked, from the shared composer context. */
export function useAgentSelectableSelected(
  kind: string | undefined,
  id: string | undefined,
): boolean {
  const key = kind && id ? agentSelectionContextKey(kind, id) : null;
  const getSnapshot = useCallback(
    () =>
      key !== null &&
      getAgentChatContextState().items.some((item) => item.key === key),
    [key],
  );
  return useSyncExternalStore(
    subscribeAgentChatContext,
    getSnapshot,
    () => false,
  );
}

const SERVER_SNAPSHOT: AgentSelectSnapshot = { active: false, available: 0 };

/** Whether Select is offered (anything registered) and whether it is on. */
export function useAgentSelectMode(): AgentSelectSnapshot {
  return useSyncExternalStore(
    subscribeAgentSelect,
    getAgentSelectSnapshot,
    () => SERVER_SNAPSHOT,
  );
}
