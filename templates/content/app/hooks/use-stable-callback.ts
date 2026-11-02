import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Returns a function that keeps one identity for the component's lifetime and
 * always runs the latest `callback`, so memoized children don't re-render when
 * their parent's handlers are recreated. Call it from events and effects only:
 * during render it would still run the previous render's callback.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
