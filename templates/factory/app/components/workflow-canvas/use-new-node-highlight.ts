import { useEffect, useState } from "react";

/** How long a step that just appeared stays marked on the canvas. */
export const NEW_NODE_WINDOW_MS = 2500;

const NONE: ReadonlySet<string> = new Set();

/**
 * Remembers which node ids have appeared since the first list it saw, and
 * when. That first list is the baseline, so steps already on the page are not
 * marked. Takes the clock as an argument so the window can be tested.
 */
export function createNewNodeTracker(windowMs = NEW_NODE_WINDOW_MS) {
  let seen: ReadonlySet<string> | null = null;
  const appearedAt = new Map<string, number>();

  const live = (now: number): ReadonlySet<string> => {
    for (const [id, at] of appearedAt) {
      if (now - at >= windowMs) appearedAt.delete(id);
    }
    return new Set(appearedAt.keys());
  };

  return {
    /** Records the ids the graph has now, and returns the ones still marked at `now`. */
    observe(nodeIds: readonly string[], now: number): ReadonlySet<string> {
      const current = new Set(nodeIds);
      if (seen) {
        for (const id of current) {
          if (!seen.has(id)) appearedAt.set(id, now);
        }
      }
      // A step that left the graph loses its mark, even if it comes back later.
      for (const id of appearedAt.keys()) {
        if (!current.has(id)) appearedAt.delete(id);
      }
      seen = current;
      return live(now);
    },
    live,
    /** When the first mark ends, or undefined when nothing is marked. */
    nextExpiry(): number | undefined {
      let earliest: number | undefined;
      for (const at of appearedAt.values()) {
        if (earliest === undefined || at < earliest) earliest = at;
      }
      return earliest === undefined ? undefined : earliest + windowMs;
    },
  };
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/**
 * The ids of the steps that appeared in `nodeIds` within the last
 * `NEW_NODE_WINDOW_MS`. Pass a memoized list, so the comparison runs only when
 * the graph changes.
 */
export function useNewNodeHighlight(
  nodeIds: readonly string[],
): ReadonlySet<string> {
  const [tracker] = useState(() => createNewNodeTracker());
  const [marked, setMarked] = useState<ReadonlySet<string>>(NONE);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Marks end at different times, so the timer is set for the first one to end, then again after it.
    const endMarks = () => {
      const expiry = tracker.nextExpiry();
      if (expiry === undefined) return;
      timer = setTimeout(
        () => {
          const live = tracker.live(Date.now());
          setMarked((previous) => (sameIds(previous, live) ? previous : live));
          endMarks();
        },
        Math.max(0, expiry - Date.now()),
      );
    };
    const live = tracker.observe(nodeIds, Date.now());
    setMarked((previous) => (sameIds(previous, live) ? previous : live));
    endMarks();
    return () => clearTimeout(timer);
  }, [tracker, nodeIds]);

  return marked;
}
