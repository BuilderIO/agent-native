import type {
  DashboardAnnotations,
  SqlPanel,
} from "../../app/pages/adhoc/sql-dashboard/types";
import {
  dataNotesForPanel,
  panelDrawsDataNotes,
  type DataNote,
} from "../../shared/data-notes.js";
import { repairKnownFirstPartyDashboardQueries } from "./canonical-first-party-dashboard-repair.js";
import type { DashboardRecord } from "./dashboards-store.js";

/**
 * Another organization's notes as one of its dashboards shows them: only the
 * ones its charts draw, with the ones it hides unless the reader can show
 * them again, and no member emails or pins to its other dashboards.
 */
export function dataNotesForReader(
  notes: readonly DataNote[],
  dashboard: DashboardRecord,
): DataNote[] {
  const config = repairKnownFirstPartyDashboardQueries(
    dashboard.id,
    dashboard.config as Record<string, unknown>,
  ).config as { panels?: SqlPanel[]; annotations?: DashboardAnnotations };
  const annotations = dashboard.canEdit ? undefined : config.annotations;
  const shown = new Set(
    (config.panels ?? [])
      .filter(panelDrawsDataNotes)
      .flatMap((panel) =>
        dataNotesForPanel(notes, dashboard.id, panel, annotations).map(
          (note) => note.id,
        ),
      ),
  );
  return notes
    .filter((note) => shown.has(note.id))
    .map(({ addedBy: _, ...note }) => ({
      ...note,
      panels: note.panels.filter((ref) => ref.dashboardId === dashboard.id),
    }));
}
