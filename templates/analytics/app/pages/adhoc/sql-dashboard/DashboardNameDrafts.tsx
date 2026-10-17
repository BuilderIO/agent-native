import { useSession } from "@agent-native/core/client/hooks";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { UNSAFE_DataRouterContext, type RouterState } from "react-router";

import { dashboardCacheScope } from "@/lib/prefetch-keys";

type ViewDraft = { name: string; isDefault: boolean };
type Drafts = {
  dashboardId: string;
  route: string;
  view?: ViewDraft;
  preset?: { filterId: string; name: string };
};
const DraftContext = createContext<{
  drafts: Drafts | null;
  setDrafts: Dispatch<SetStateAction<Drafts | null>>;
} | null>(null);
export const NameDraftDashboardContext = createContext<string | null>(null);

function routeOwner(state: RouterState) {
  return JSON.stringify([
    state.location.pathname,
    new URLSearchParams(state.location.search).get("id"),
  ]);
}

export function DashboardNameDrafts({ children }: { children: ReactNode }) {
  const { session, status } = useSession();
  const scope =
    session && status !== "signing-out" ? dashboardCacheScope(session) : null;
  const [record, setRecord] = useState(() => ({
    scope,
    generation: {},
    drafts: null as Drafts | null,
  }));
  if (record.scope !== scope) {
    setRecord({ scope, generation: {}, drafts: null });
  }
  const generation = record.generation;
  const setDrafts = useCallback<Dispatch<SetStateAction<Drafts | null>>>(
    (next) => {
      setRecord((current) => {
        // Scope changes revoke captured setters, even if the account returns.
        if (scope === null || current.generation !== generation) return current;
        const drafts = typeof next === "function" ? next(current.drafts) : next;
        return drafts === current.drafts ? current : { ...current, drafts };
      });
    },
    [scope, generation],
  );
  return (
    <DraftContext value={{ drafts: record.drafts, setDrafts }}>
      {children}
    </DraftContext>
  );
}

export function DashboardNameDraftRouterBridge() {
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const setDrafts = useContext(DraftContext)?.setDrafts;
  useLayoutEffect(() => {
    if (!router || !setDrafts) return;
    const discardAfterNavigation = (state: RouterState) => {
      if (
        !state.initialized ||
        state.errors ||
        state.navigation.state !== "idle"
      )
        return;
      setDrafts((current) =>
        current && current.route !== routeOwner(state) ? null : current,
      );
    };
    discardAfterNavigation(router.state);
    return router.subscribe(discardAfterNavigation);
  }, [router, setDrafts]);
  return null;
}

const EMPTY_VIEW: ViewDraft = { name: "", isDefault: false };

export function useDashboardNameDraft<T extends ViewDraft | string>(
  kind: T extends string ? "preset" : "view",
  initial: T,
  filterId?: string,
): readonly [T, Dispatch<SetStateAction<T>>] {
  const owner = useContext(DraftContext);
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const dashboardId = useContext(NameDraftDashboardContext);
  const [local, setLocal] = useState(initial);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!owner || !router || !dashboardId) return [local, setLocal];
  const current =
    owner.drafts?.dashboardId === dashboardId ? owner.drafts : null;
  const value = (
    kind === "view"
      ? (current?.view ?? EMPTY_VIEW)
      : current?.preset?.filterId === filterId
        ? (current?.preset?.name ?? "")
        : ""
  ) as T;
  return [
    value,
    (next) => {
      // An async save from an unmounted form cannot clear a recovered form.
      if (!mounted.current) return;
      owner.setDrafts((previous) => {
        if (!mounted.current) return previous;
        const draft =
          previous?.dashboardId === dashboardId
            ? previous
            : {
                dashboardId,
                route: routeOwner(router.state),
              };
        const before = (
          kind === "view"
            ? (draft.view ?? EMPTY_VIEW)
            : draft.preset?.filterId === filterId
              ? (draft.preset?.name ?? "")
              : ""
        ) as T;
        const updated = typeof next === "function" ? next(before) : next;
        return kind === "view"
          ? { ...draft, view: updated as ViewDraft }
          : {
              ...draft,
              preset: { filterId: filterId!, name: updated as string },
            };
      });
    },
  ];
}
