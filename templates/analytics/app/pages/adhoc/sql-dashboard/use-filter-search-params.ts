import {
  startTransition,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  UNSAFE_DataRouterContext,
  useLocation,
  useNavigate,
  useParams,
  type RouterState,
} from "react-router";

type Draft = { key: string; params: URLSearchParams };
type Scope = {
  loadedDashboardId: string | null | undefined;
  renderedDashboardId: string | undefined;
};
const subscribeToNothing = () => () => {};
const noServerNavigation = () => null;

// Only read navigation within this dashboard can compose with this bar's
// config. Preserve other destinations and in-flight writes.
function admitsFilterEdits(
  state: RouterState | null | undefined,
  loadedDashboardId: string | null | undefined,
  renderedDashboardId: string | undefined,
) {
  const committedId = state
    ? new URLSearchParams(state.location.search).get("id") ||
      state.matches[state.matches.length - 1]?.params.id
    : renderedDashboardId;
  if (
    loadedDashboardId !== undefined &&
    (!loadedDashboardId || loadedDashboardId !== committedId)
  )
    return false;
  if (!state) return true;
  const { location: committed, navigation } = state;
  const target = navigation.location ?? committed;
  return (
    (!navigation.formMethod || navigation.formMethod === "GET") &&
    target.pathname === committed.pathname &&
    new URLSearchParams(target.search).get("id") ===
      new URLSearchParams(committed.search).get("id")
  );
}

export function useFilterSearchParams(loadedDashboardId?: string | null) {
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const renderedLocation = useLocation();
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const renderedDashboardId =
    new URLSearchParams(renderedLocation.search).get("id") || routeId;
  const scope = useRef<Scope | null>(null);
  useLayoutEffect(() => {
    scope.current = { loadedDashboardId, renderedDashboardId };
    return () => {
      scope.current = null;
    };
  }, [loadedDashboardId, renderedDashboardId]);
  const canUpdate = useCallback(() => {
    const committedScope = scope.current;
    return (
      committedScope !== null &&
      admitsFilterEdits(
        router?.state,
        committedScope.loadedDashboardId,
        committedScope.renderedDashboardId,
      )
    );
  }, [router]);
  // Only this bar subscribes synchronously; route/dashboard rendering stays in
  // the router's transition. Action promises can outlive their navigation.
  const state = useSyncExternalStore(
    router?.subscribe ?? subscribeToNothing,
    useCallback(() => router?.state ?? null, [router]),
    noServerNavigation,
  );
  const [draft, setDraft] = useState<Draft>();
  const latest = useRef<Draft>(undefined);
  const location = state?.location ?? renderedLocation;
  const activeKey = state?.navigation.location?.key;
  const displayed =
    draft && draft.key === activeKey
      ? draft.params
      : new URLSearchParams(location.search);

  const updateParams = useCallback(
    (update: (prev: URLSearchParams) => URLSearchParams) => {
      const current = router?.state;
      const committed = current?.location ?? renderedLocation;
      const location = current?.navigation.location ?? committed;
      if (!canUpdate()) return;
      const key = current?.navigation.location?.key;
      const params = update(
        new URLSearchParams(
          latest.current && latest.current.key === key
            ? latest.current.params
            : location.search,
        ),
      );
      let accepted: Draft | undefined;
      startTransition(() => {
        const navigation = navigate({
          search: `?${params}`,
          hash: location.hash,
        });
        const next = router?.state.navigation.location;
        // A blocked request leaves the prior navigation (and its key) intact.
        if (next && next.key !== key) {
          accepted = { key: next.key, params };
          latest.current = accepted;
        }
        return navigation;
      });
      if (accepted) setDraft(accepted);
    },
    [router, renderedLocation, navigate, canUpdate],
  );

  return [
    displayed,
    updateParams,
    !admitsFilterEdits(state, loadedDashboardId, renderedDashboardId),
    canUpdate,
  ] as const;
}
