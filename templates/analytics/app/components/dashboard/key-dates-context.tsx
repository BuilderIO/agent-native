import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { keyDateEvents, panelEventsWithKeyDates } from "@shared/key-dates";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import type {
  DashboardAnnotations,
  PanelEvent,
  SqlPanel,
} from "@/pages/adhoc/sql-dashboard/types";

interface DashboardKeyDatesValue {
  keyDates: readonly PanelEvent[];
  /** The latest load failed, so the markers drawn may be missing or out of date. */
  keyDatesFailed: boolean;
}

const NO_KEY_DATES: readonly PanelEvent[] = [];
const KeyDatesContext = createContext<DashboardKeyDatesValue>({
  keyDates: NO_KEY_DATES,
  keyDatesFailed: false,
});

/** Draws the organization's key dates, minus the sets this dashboard hides, on every time chart inside. */
export function DashboardKeyDatesProvider({
  annotations,
  children,
}: {
  annotations?: DashboardAnnotations;
  children: ReactNode;
}) {
  const t = useT();
  const { data, isError } = useActionQuery("list-key-dates", undefined, {
    staleTime: 60_000,
  });
  // A failed refresh keeps the last list in `data`; it still has to say so.
  const keyDatesFailed = isError;
  useEffect(() => {
    if (keyDatesFailed) {
      toast.error(t("dashboard.keyDatesUnavailable"), {
        id: "key-dates-unavailable",
      });
    }
  }, [keyDatesFailed, t]);
  const value = useMemo<DashboardKeyDatesValue>(
    () => ({
      keyDates: data ? keyDateEvents(data.sets, annotations) : NO_KEY_DATES,
      keyDatesFailed,
    }),
    [data, annotations, keyDatesFailed],
  );
  return (
    <KeyDatesContext.Provider value={value}>
      {children}
    </KeyDatesContext.Provider>
  );
}

/**
 * Draws key dates already resolved for one dashboard. A Human Review preview
 * can show another organization's dashboard, whose key dates list-key-dates
 * does not return, so get-sql-dashboard sends them with it.
 */
export function ResolvedKeyDatesProvider({
  keyDates,
  children,
}: {
  keyDates: readonly PanelEvent[];
  children: ReactNode;
}) {
  const value = useMemo<DashboardKeyDatesValue>(
    () => ({ keyDates, keyDatesFailed: false }),
    [keyDates],
  );
  return (
    <KeyDatesContext.Provider value={value}>
      {children}
    </KeyDatesContext.Provider>
  );
}

/** A panel's own events plus the dashboard's key dates, for `useEventMarkerGroups`. */
export function usePanelEvents(
  panel: Pick<SqlPanel, "chartType" | "config">,
): unknown {
  const { keyDates } = useContext(KeyDatesContext);
  const { chartType } = panel;
  const events = panel.config?.events;
  return useMemo(
    () => panelEventsWithKeyDates({ chartType, config: { events } }, keyDates),
    [chartType, events, keyDates],
  );
}
