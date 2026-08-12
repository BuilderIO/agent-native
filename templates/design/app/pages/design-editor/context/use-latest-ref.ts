import { useRef } from "react";

/**
 * Mirrors a render value into a ref so a stable callback reads it at call time
 * instead of at the render that created the callback.
 *
 * Writing during render (rather than in an effect) is deliberate: an editor
 * command dispatched from a user event in the same commit must observe that
 * commit's value, and an effect would not have run yet for a render React
 * discarded.
 *
 * This changes WHEN a value is observed, so it is only sound for callbacks
 * invoked from user events or imperative command entry points, where React has
 * already flushed the pending render. Do not route effect/timer closures, the
 * `renderScreenContent` / `renderBreakpointContent` / `renderEditableScreenContent`
 * trio, or any callback whose dep array is load-bearing for child memoization
 * through a latest ref.
 */
export function useLatestRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
