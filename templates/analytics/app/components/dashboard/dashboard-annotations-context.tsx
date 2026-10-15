import { useActionQuery } from "@agent-native/core/client/hooks";
import { dataNotesForPanel, type DataNote } from "@shared/data-notes";
import { keyDateEvents, panelEventsWithKeyDates } from "@shared/key-dates";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import type {
  DashboardAnnotations,
  PanelEvent,
  SqlPanel,
} from "@/pages/adhoc/sql-dashboard/types";

interface DashboardAnnotationsValue {
  dashboardId: string | null;
  annotations?: DashboardAnnotations;
  keyDates: readonly PanelEvent[];
  dataNotes: readonly DataNote[];
}

const NO_KEY_DATES: readonly PanelEvent[] = [];
const NO_DATA_NOTES: readonly DataNote[] = [];
const NO_ANNOTATIONS: DashboardAnnotationsValue = {
  dashboardId: null,
  keyDates: NO_KEY_DATES,
  dataNotes: NO_DATA_NOTES,
};
const DashboardAnnotationsContext =
  createContext<DashboardAnnotationsValue>(NO_ANNOTATIONS);

/**
 * Draws the organization's key dates, minus the sets this dashboard hides,
 * and its data notes, minus the ones hidden per chart, on every chart inside.
 */
export function DashboardAnnotationsProvider({
  dashboardId,
  annotations,
  children,
}: {
  dashboardId?: string | null;
  annotations?: DashboardAnnotations;
  children: ReactNode;
}) {
  const { data: keyDateData } = useActionQuery("list-key-dates", undefined, {
    staleTime: 60_000,
  });
  const { data: dataNoteData } = useActionQuery("list-data-notes", undefined, {
    staleTime: 60_000,
  });
  const value = useMemo<DashboardAnnotationsValue>(
    () => ({
      dashboardId: dashboardId ?? null,
      annotations,
      keyDates: keyDateData
        ? keyDateEvents(keyDateData.sets, annotations)
        : NO_KEY_DATES,
      dataNotes: dataNoteData?.notes ?? NO_DATA_NOTES,
    }),
    [dashboardId, annotations, keyDateData, dataNoteData],
  );
  return (
    <DashboardAnnotationsContext.Provider value={value}>
      {children}
    </DashboardAnnotationsContext.Provider>
  );
}

/** A panel's own events plus the dashboard's key dates, for `renderEventMarkers`. */
export function usePanelEvents(
  panel: Pick<SqlPanel, "chartType" | "config">,
): unknown {
  const { keyDates } = useContext(DashboardAnnotationsContext);
  const { chartType } = panel;
  const events = panel.config?.events;
  return useMemo(
    () => panelEventsWithKeyDates({ chartType, config: { events } }, keyDates),
    [chartType, events, keyDates],
  );
}

/** The data notes that belong on a panel and are not hidden there. */
export function usePanelDataNotes(
  panel: Pick<SqlPanel, "id" | "sql">,
): readonly DataNote[] {
  const { dashboardId, annotations, dataNotes } = useContext(
    DashboardAnnotationsContext,
  );
  const { id, sql } = panel;
  return useMemo(
    () =>
      dashboardId && dataNotes.length > 0
        ? dataNotesForPanel(dataNotes, dashboardId, { id, sql }, annotations)
        : NO_DATA_NOTES,
    [dashboardId, annotations, dataNotes, id, sql],
  );
}
