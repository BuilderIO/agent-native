import type { DashboardPanelChartHost } from "@agent-native/toolkit/app/dashboard-charts/panel-chart-host";
import type { DataNote } from "@shared/data-notes";

import {
  usePanelDataNotes,
  usePanelEvents,
} from "./dashboard-annotations-context";
import {
  DataNoteLines,
  renderDataNoteBands,
  useDataNoteChartMargin,
  useDataNoteLayout,
  type ShadedDataNote,
} from "./data-note-bands";

/** Analytics' key dates, data notes and session replay links on toolkit's dashboard charts. */
export const ANALYTICS_CHART_HOST: DashboardPanelChartHost = {
  usePanelEvents,
  usePanelDataNotes,
  useDataNoteLayout(notes: readonly DataNote[], rows, xKey) {
    return useDataNoteLayout(notes, rows, xKey);
  },
  useDataNoteChartMargin(shaded: readonly ShadedDataNote[]) {
    return useDataNoteChartMargin(shaded);
  },
  renderDataNoteLines(notes: readonly DataNote[], panelId) {
    return <DataNoteLines notes={notes} panelId={panelId} />;
  },
  renderDataNoteBands(shaded: readonly ShadedDataNote[], options) {
    return renderDataNoteBands(shaded, options);
  },
  sessionReplays: true,
};
