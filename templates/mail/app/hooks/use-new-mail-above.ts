import { useCallback, useEffect, useState } from "react";

import type { ThreadSummary } from "@/lib/threads";

export interface NewMailAboveState {
  listKey: string | null;
  known: ReadonlySet<string> | null;
  oldest: number;
  arrived: ReadonlySet<string>;
}

export const INITIAL_NEW_MAIL_ABOVE: NewMailAboveState = {
  listKey: null,
  known: null,
  oldest: Number.NEGATIVE_INFINITY,
  arrived: new Set(),
};

function oldestSent(threads: readonly ThreadSummary[]): number {
  let oldest = Number.POSITIVE_INFINITY;
  for (const thread of threads) {
    const time = Date.parse(thread.latestMessage.date);
    if (time < oldest) oldest = time;
  }
  return oldest === Number.POSITIVE_INFINITY
    ? Number.NEGATIVE_INFINITY
    : oldest;
}

export function trackNewMailAbove(
  state: NewMailAboveState,
  listKey: string | null,
  threads: readonly ThreadSummary[],
  firstVisibleIndex: number,
): NewMailAboveState {
  if (listKey === null) {
    return state.listKey === null && state.known === null
      ? state
      : INITIAL_NEW_MAIL_ABOVE;
  }
  if (state.listKey !== listKey || state.known === null) {
    if (threads.length === 0) {
      return { ...INITIAL_NEW_MAIL_ABOVE, listKey };
    }
    return {
      listKey,
      known: new Set(threads.map((t) => t.latestMessage.id)),
      oldest: oldestSent(threads),
      arrived: new Set(),
    };
  }

  let known = state.known;
  let oldest = state.oldest;
  const arrived = new Set(state.arrived);
  const indexes = new Map<string, number>();
  threads.forEach((thread, index) => {
    const id = thread.latestMessage.id;
    indexes.set(id, index);
    if (known.has(id)) return;
    if (known === state.known) known = new Set(known);
    (known as Set<string>).add(id);
    const time = Date.parse(thread.latestMessage.date);
    if (time < oldest) {
      oldest = time;
    } else if (!thread.latestMessage.isRead && index < firstVisibleIndex) {
      arrived.add(id);
    }
  });
  for (const id of arrived) {
    const index = indexes.get(id);
    if (
      index === undefined ||
      index >= firstVisibleIndex ||
      threads[index]?.latestMessage.isRead !== false
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
  return { listKey, known, oldest, arrived };
}

export function useNewMailAbove(
  listKey: string | null,
  threads: readonly ThreadSummary[],
  firstVisibleIndex: number,
) {
  const [state, setState] = useState(INITIAL_NEW_MAIL_ABOVE);

  useEffect(() => {
    setState((prev) =>
      trackNewMailAbove(prev, listKey, threads, firstVisibleIndex),
    );
  }, [listKey, threads, firstVisibleIndex]);

  const arrived =
    listKey !== null && state.listKey === listKey
      ? state.arrived
      : INITIAL_NEW_MAIL_ABOVE.arrived;
  const clear = useCallback(
    () =>
      setState((prev) =>
        prev.arrived.size === 0 ? prev : { ...prev, arrived: new Set() },
      ),
    [],
  );
  return { arrived, clear };
}
