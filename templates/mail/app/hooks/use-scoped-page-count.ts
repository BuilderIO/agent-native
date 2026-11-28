import { useCallback, useState } from "react";

export function useScopedPageCount(
  scope: string,
  initialCount: number,
): readonly [number, () => void] {
  const [state, setState] = useState({ scope, count: initialCount });
  const count = state.scope === scope ? state.count : initialCount;
  const addPage = useCallback(
    () =>
      setState((previous) => ({
        scope,
        count: (previous.scope === scope ? previous.count : initialCount) + 1,
      })),
    [scope, initialCount],
  );
  return [count, addPage] as const;
}
