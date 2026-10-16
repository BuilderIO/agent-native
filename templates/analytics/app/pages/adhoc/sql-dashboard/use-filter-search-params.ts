import {
  useCallback,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useTransition,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

export function useFilterSearchParams() {
  const [committed] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [pending, startTransition] = useTransition();
  const canonical = { pathname: location.pathname, params: committed };
  const [displayed, setDisplayed] = useOptimistic(
    canonical,
    (base, draft: typeof canonical) =>
      draft.pathname === base.pathname &&
      draft.params.get("id") === base.params.get("id")
        ? draft
        : base,
  );
  const latest = useRef(canonical);
  useLayoutEffect(() => {
    if (
      !pending ||
      latest.current.pathname !== location.pathname ||
      latest.current.params.get("id") !== committed.get("id")
    ) {
      latest.current = canonical;
    }
  });

  const updateParams = useCallback(
    (update: (prev: URLSearchParams) => URLSearchParams) => {
      const params = update(new URLSearchParams(latest.current.params));
      latest.current = { pathname: location.pathname, params };
      startTransition(() => {
        setDisplayed(latest.current);
        // Keep the draft for the router action's lifetime, including rollback
        // to its actual location after a blocked or interrupted navigation.
        return navigate({ search: `?${params}`, hash: location.hash });
      });
    },
    [location.pathname, location.hash, navigate],
  );

  return [displayed.params, updateParams] as const;
}
