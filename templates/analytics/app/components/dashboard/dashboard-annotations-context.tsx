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

/** What a chart's data-note card offers; absent outside an editable dashboard. */
export interface DataNoteActions {
  /** Starts a note pinned to this chart. */
  add(panelId: string): void;
  edit(note: DataNote): void;
  markFixed(note: DataNote): void;
  /** Absent when the viewer can't edit this dashboard. */
  hide?(noteId: string, panelId: string): void;
}

interface DashboardAnnotationsValue {
  dashboardId: string | null;
  annotations?: DashboardAnnotations;
  keyDates: readonly PanelEvent[];
  /** The list failed to load, so a chart without markers may still have key dates. */
  keyDatesFailed: boolean;
  dataNotes: readonly DataNote[];
  /** The list failed to load, so a chart without notes may still have some. */
  dataNotesFailed: boolean;
  dataNoteActions?: DataNoteActions;
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
  dataNoteActions,
  children,
}: {
  dashboardId?: string | null;
  annotations?: DashboardAnnotations;
  dataNoteActions?: DataNoteActions;
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
  const keyDatesFailed = keyDateQuery.isError && !keyDateData;
  const dataNotesFailed = dataNoteQuery.isError && !dataNoteData;
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
  const value = useMemo<DashboardAnnotationsValue>(
    () => ({
      dashboardId: dashboardId ?? null,
      annotations,
      keyDates: keyDateData
        ? keyDateEvents(keyDateData.sets, annotations)
        : NO_KEY_DATES,
      keyDatesFailed,
      dataNotes: dataNoteData ? dataNoteData.notes : NO_DATA_NOTES,
      dataNotesFailed,
      dataNoteActions,
    }),
    [
      dashboardId,
      annotations,
      keyDateData,
      keyDatesFailed,
      dataNoteData,
      dataNotesFailed,
      dataNoteActions,
    ],
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

export function useDataNoteActions(): DataNoteActions | undefined {
  return useContext(DashboardAnnotationsContext).dataNoteActions;
}
