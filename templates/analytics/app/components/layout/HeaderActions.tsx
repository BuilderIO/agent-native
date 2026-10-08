import { useT } from "@agent-native/core/client/i18n";
import {
  useEffect,
  useSyncExternalStore,
  type ReactNode,
  type FC,
} from "react";

import { Skeleton } from "@/components/ui/skeleton";

type Listener = () => void;

let currentTitle: ReactNode = null;
let currentActions: ReactNode = null;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useHeaderTitle(): ReactNode {
  return useSyncExternalStore(
    subscribe,
    () => currentTitle,
    () => currentTitle,
  );
}

export function useHeaderActions(): ReactNode {
  return useSyncExternalStore(
    subscribe,
    () => currentActions,
    () => currentActions,
  );
}

export const HeaderActionsProvider: FC<{ children: ReactNode }> = ({
  children,
}) => <>{children}</>;

export function useSetPageTitle(node: ReactNode) {
  useEffect(() => {
    currentTitle = node;
    notify();
    return () => {
      currentTitle = null;
      notify();
    };
  });
}

export function useSetHeaderActions(node: ReactNode) {
  useEffect(() => {
    currentActions = node;
    notify();
    return () => {
      currentActions = null;
      notify();
    };
  });
}

export function DashboardTitleSkeleton() {
  const t = useT();
  return (
    <Skeleton
      className="h-6 w-56"
      aria-label={t("navigation.loadingDashboardTitle")}
    />
  );
}
