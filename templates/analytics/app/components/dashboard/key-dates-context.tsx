import { useActionQuery } from "@agent-native/core/client/hooks";
import { keyDateEvents, panelEventsWithKeyDates } from "@shared/key-dates";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import type {
  DashboardAnnotations,
  PanelEvent,
  SqlPanel,
} from "@/pages/adhoc/sql-dashboard/types";

const NO_KEY_DATES: readonly PanelEvent[] = [];
const KeyDatesContext = createContext<readonly PanelEvent[]>(NO_KEY_DATES);

/** Draws the organization's key dates, minus the sets this dashboard hides, on every time chart inside. */
export function DashboardKeyDatesProvider({
  annotations,
  children,
}: {
  annotations?: DashboardAnnotations;
  children: ReactNode;
}) {
  const { data } = useActionQuery("list-key-dates", undefined, {
    staleTime: 60_000,
  });
  const events = useMemo(
    () => (data ? keyDateEvents(data.sets, annotations) : NO_KEY_DATES),
    [data, annotations],
  );
  return (
    <KeyDatesContext.Provider value={events}>
      {children}
    </KeyDatesContext.Provider>
  );
}

/** A panel's own events plus the dashboard's key dates, for `renderEventMarkers`. */
export function usePanelEvents(
  panel: Pick<SqlPanel, "chartType" | "config">,
): unknown {
  const keyDates = useContext(KeyDatesContext);
  const { chartType } = panel;
  const events = panel.config?.events;
  return useMemo(
    () => panelEventsWithKeyDates({ chartType, config: { events } }, keyDates),
    [chartType, events, keyDates],
  );
}
