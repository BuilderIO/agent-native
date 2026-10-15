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
  /** Starts a note pinned to this chart. Absent, like edit and markFixed, when the notes belong to another organization. */
  add?(panelId: string): void;
  edit?(note: DataNote): void;
  markFixed?(note: DataNote): void;
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
 * Draws the dashboard's key dates, minus the sets it hides, and its data
 * notes, minus the ones hidden per chart, on every chart inside. Both are its
 * owner organization's, which differ from the viewer's when it was shared
 * from another organization.
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
  const scope = dashboardId ? { dashboardId } : undefined;
  const keyDateQuery = useActionQuery("list-key-dates", scope, {
    staleTime: 60_000,
  });
  const dataNoteQuery = useActionQuery("list-data-notes", scope, {
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
  // A shared dashboard's notes are its organization's: the viewer may hide
  // one here, but their own edits would save into their own organization.
  const notesEditable = dataNoteData?.editable !== false;
  const noteActions = useMemo<DataNoteActions | undefined>(() => {
    if (notesEditable || !dataNoteActions) return dataNoteActions;
    return dataNoteActions.hide ? { hide: dataNoteActions.hide } : undefined;
  }, [notesEditable, dataNoteActions]);
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
      dataNoteActions: noteActions,
    }),
    [
      dashboardId,
      annotations,
      keyDates,
      keyDatesFailed,
      dataNoteData,
      dataNotesFailed,
      noteActions,
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

export function useDataNoteActions(): DataNoteActions | undefined {
  return useContext(DashboardAnnotationsContext).dataNoteActions;
}
