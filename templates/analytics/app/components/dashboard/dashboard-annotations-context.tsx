import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { dataNotesForPanel, type DataNote } from "@shared/data-notes";
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

interface DashboardAnnotationsValue {
  dashboardId: string | null;
  annotations?: DashboardAnnotations;
  keyDates: readonly PanelEvent[];
  /** The list failed to load, so a chart without markers may still have key dates. */
  keyDatesFailed: boolean;
  dataNotes: readonly DataNote[];
  /** The list failed to load, so a chart without notes may still have some. */
  dataNotesFailed: boolean;
}

const NO_KEY_DATES: readonly PanelEvent[] = [];
const NO_DATA_NOTES: readonly DataNote[] = [];
const NO_ANNOTATIONS: DashboardAnnotationsValue = {
  dashboardId: null,
  keyDates: NO_KEY_DATES,
  keyDatesFailed: false,
  dataNotes: NO_DATA_NOTES,
  dataNotesFailed: false,
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
  const t = useT();
  const keyDateQuery = useActionQuery("list-key-dates", undefined, {
    staleTime: 60_000,
  });
  const dataNoteQuery = useActionQuery("list-data-notes", undefined, {
    staleTime: 60_000,
  });
  const keyDateData = keyDateQuery.data;
  const dataNoteData = dataNoteQuery.data;
  // A failed refresh keeps the last list in `data`; it still has to say so.
  const keyDatesFailed = keyDateQuery.isError;
  const dataNotesFailed = dataNoteQuery.isError;
  useEffect(() => {
    if (keyDatesFailed) {
      toast.error(t("dashboard.keyDatesUnavailable"), {
        id: "key-dates-unavailable",
      });
    }
  }, [keyDatesFailed, t]);
  useEffect(() => {
    if (dataNotesFailed) {
      toast.error(t("dashboard.dataNotesUnavailable"), {
        id: "data-notes-unavailable",
      });
    }
  }, [dataNotesFailed, t]);
  // Its own memo: a changed note list must not re-resolve every chart's key dates.
  const keyDates = useMemo(
    () =>
      keyDateData ? keyDateEvents(keyDateData.sets, annotations) : NO_KEY_DATES,
    [keyDateData, annotations],
  );
  const value = useMemo<DashboardAnnotationsValue>(
    () => ({
      dashboardId: dashboardId ?? null,
      annotations,
      keyDates,
      keyDatesFailed,
      dataNotes: dataNoteData ? dataNoteData.notes : NO_DATA_NOTES,
      dataNotesFailed,
    }),
    [
      dashboardId,
      annotations,
      keyDates,
      keyDatesFailed,
      dataNoteData,
      dataNotesFailed,
    ],
  );
  return (
    <DashboardAnnotationsContext.Provider value={value}>
      {children}
    </DashboardAnnotationsContext.Provider>
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
  const value = useMemo<DashboardAnnotationsValue>(
    () => ({ ...NO_ANNOTATIONS, keyDates }),
    [keyDates],
  );
  return (
    <DashboardAnnotationsContext.Provider value={value}>
      {children}
    </DashboardAnnotationsContext.Provider>
  );
}

/** A panel's own events plus the dashboard's key dates, for `useEventMarkerGroups`. */
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
