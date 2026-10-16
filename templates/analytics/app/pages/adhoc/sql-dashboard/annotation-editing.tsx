import { useCallback, useMemo, useState, type ReactNode } from "react";

import { isPendingAnnotation } from "@/components/dashboard/annotation-mutations";
import type { DataNoteActions } from "@/components/dashboard/dashboard-annotations-context";

import { AnnotationsMenu } from "./AnnotationsMenu";
import { DataNoteDialog, type DataNoteDraft } from "./DataNoteDialog";
import { KeyDateDialog, type KeyDateDraft } from "./KeyDateDialog";
import { KeyDateSetsDialog } from "./KeyDateSetsDialog";
import type { DashboardAnnotations, SqlDashboardConfig } from "./types";

/**
 * The Annotations header menu, its dialogs, and the actions a chart's
 * data-note card offers. Key dates and notes belong to the organization;
 * only which ones a dashboard hides is saved with the dashboard. Either way a
 * change shows for everyone, so all of it waits for Edit mode.
 */
export function useAnnotationEditing({
  dashboardId,
  dashboard,
  editing,
  persist,
}: {
  dashboardId: string | undefined;
  dashboard: SqlDashboardConfig | null;
  editing: boolean;
  persist: (updated: SqlDashboardConfig) => void;
}): {
  menu: ReactNode;
  dialogs: ReactNode;
  dataNoteActions: DataNoteActions | undefined;
} {
  const [noteDraft, setNoteDraft] = useState<DataNoteDraft | null>(null);
  const [keyDateDraft, setKeyDateDraft] = useState<KeyDateDraft | null>(null);
  const [keyDatesOpen, setKeyDatesOpen] = useState(false);
  const annotations = dashboard?.annotations;

  const updateAnnotations = useCallback(
    (next: DashboardAnnotations) => {
      if (!dashboard) return;
      const placeholder = [
        ...(next.hiddenKeyDateSets ?? []),
        ...(next.hiddenDataNotes ?? []).map((entry) => entry.noteId),
      ].find(isPendingAnnotation);
      if (placeholder) {
        throw new Error(
          `Can't save the unconfirmed annotation ${placeholder} to the dashboard; its controls should stay disabled until the server confirms it.`,
        );
      }
      const { annotations: _previous, ...rest } = dashboard;
      persist(
        Object.keys(next).length > 0 ? { ...rest, annotations: next } : rest,
      );
    },
    [dashboard, persist],
  );
  const onAnnotationsChange = editing ? updateAnnotations : undefined;

  const dataNoteActions = useMemo<DataNoteActions>(
    () => ({
      add: (panelId) => {
        if (!dashboardId) return;
        setNoteDraft({ initial: { panels: [{ dashboardId, panelId }] } });
      },
      edit: (note) => setNoteDraft({ note }),
      markFixed: (note) => setNoteDraft({ note, markFixed: true }),
      hide: (noteId, panelId) =>
        updateAnnotations({
          ...annotations,
          hiddenDataNotes: [
            ...(annotations?.hiddenDataNotes ?? []),
            { noteId, panelId },
          ],
        }),
    }),
    [annotations, dashboardId, updateAnnotations],
  );
  const chartNoteActions = editing ? dataNoteActions : undefined;

  if (!dashboardId || !dashboard) {
    return { menu: null, dialogs: null, dataNoteActions: chartNoteActions };
  }

  const menu = (
    <AnnotationsMenu
      dashboardId={dashboardId}
      panels={dashboard.panels}
      annotations={annotations}
      editing={editing}
      onAnnotationsChange={onAnnotationsChange}
      onAddKeyDate={() => setKeyDateDraft({})}
      onEditKeyDates={() => setKeyDatesOpen(true)}
      onAddDataNote={() => setNoteDraft({})}
      onEditDataNote={(note) => setNoteDraft({ note })}
    />
  );
  const dialogs = (
    <>
      <DataNoteDialog
        draft={noteDraft}
        onClose={() => setNoteDraft(null)}
        dashboardId={dashboardId}
        panels={dashboard.panels}
        annotations={annotations}
        onAnnotationsChange={onAnnotationsChange}
      />
      <KeyDateSetsDialog
        open={keyDatesOpen}
        onOpenChange={setKeyDatesOpen}
        onEditKeyDate={(keyDate) => setKeyDateDraft({ keyDate })}
        onAddKeyDate={(setId) => setKeyDateDraft({ setId })}
      />
      <KeyDateDialog
        draft={keyDateDraft}
        onClose={() => setKeyDateDraft(null)}
      />
    </>
  );
  return { menu, dialogs, dataNoteActions: chartNoteActions };
}
