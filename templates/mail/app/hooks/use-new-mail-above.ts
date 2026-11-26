import { useCallback, useEffect, useState } from "react";

import type { ThreadSummary } from "@/lib/threads";

export interface NewMailAboveState {
  listKey: string | null;
  known: ReadonlySet<string> | null;
  arrived: ReadonlySet<string>;
}

export const INITIAL_NEW_MAIL_ABOVE: NewMailAboveState = {
  listKey: null,
  known: null,
  arrived: new Set(),
};

export function trackNewMailAbove(
  state: NewMailAboveState,
  listKey: string,
  threads: readonly ThreadSummary[],
  firstVisibleIndex: number,
): NewMailAboveState {
  if (state.listKey !== listKey || state.known === null) {
    if (threads.length === 0) {
      return { listKey, known: null, arrived: new Set() };
    }
    return {
      listKey,
      known: new Set(threads.map((t) => t.latestMessage.id)),
      arrived: new Set(),
    };
  }

  let known = state.known;
  const arrived = new Set(state.arrived);
  const indexes = new Map<string, number>();
  threads.forEach((thread, index) => {
    const id = thread.latestMessage.id;
    indexes.set(id, index);
    if (known.has(id)) return;
    if (known === state.known) known = new Set(known);
    (known as Set<string>).add(id);
    if (thread.hasUnread && index < firstVisibleIndex) arrived.add(id);
  });
  for (const id of arrived) {
    const index = indexes.get(id);
    if (
      index === undefined ||
      index >= firstVisibleIndex ||
      !threads[index]?.hasUnread
    ) {
      arrived.delete(id);
    }
  }

  if (
    known === state.known &&
    arrived.size === state.arrived.size &&
    [...arrived].every((id) => state.arrived.has(id))
  ) {
    return state;
  }
  return { listKey, known, arrived };
}

export function useNewMailAbove(
  listKey: string,
  threads: readonly ThreadSummary[],
  firstVisibleIndex: number,
) {
  const [state, setState] = useState(INITIAL_NEW_MAIL_ABOVE);

  useEffect(() => {
    setState((prev) =>
      trackNewMailAbove(prev, listKey, threads, firstVisibleIndex),
    );
  }, [listKey, threads, firstVisibleIndex]);

  const count = state.listKey === listKey ? state.arrived.size : 0;
  const clear = useCallback(
    () =>
      setState((prev) =>
        prev.arrived.size === 0 ? prev : { ...prev, arrived: new Set() },
      ),
    [],
  );
  return { count, clear };
}
