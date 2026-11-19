import { createContext, useContext, type ReactNode } from "react";

import type { SqlPanel } from "../../dashboard/sql-dashboard-types.js";

/** The margin Recharts draws inside a chart when no data note needs room above it. */
const CHART_EDGE = 5;

export interface DashboardChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DashboardDataNoteBandOptions {
  rows: readonly Record<string, unknown>[];
  xKey: string;
  yAxisId?: string;
  panelId: string;
  onHoverChange?: (hovered: boolean) => void;
  /** Hears how many title rows sit above the plot; see `useDataNoteChartMargin`. */
  onLabelRows?: (rows: number) => void;
}

/**
 * What the app around a dashboard chart adds to it. Analytics supplies its
 * dashboards' key dates, data notes and session replay links. A chart drawn
 * elsewhere from stored rows gets none of them: it marks only the events in
 * its panel's `config.events`.
 *
 * Members are methods so an app can pass its own note types where these take
 * `unknown`.
 */
export interface DashboardPanelChartHost {
  /** The events a chart marks: its panel's own plus any the app adds. */
  usePanelEvents(panel: Pick<SqlPanel, "chartType" | "config">): unknown;
  /** The data notes that belong on a panel. */
  usePanelDataNotes(panel: Pick<SqlPanel, "id" | "sql">): readonly unknown[];
  /** Where each note falls on the chart's x values. */
  useDataNoteLayout(
    notes: readonly unknown[],
    rows: readonly Record<string, unknown>[],
    xKey: string,
  ): { shaded: readonly unknown[]; unplaced: readonly unknown[] };
  /** The chart margin that holds the notes' titles above the plot. */
  useDataNoteChartMargin(shaded: readonly unknown[]): {
    margin: DashboardChartMargin;
    onLabelRows: (rows: number) => void;
  };
  /** The notes a chart can't place on its dates, as lines under it. */
  renderDataNoteLines(notes: readonly unknown[], panelId: string): ReactNode;
  /** The notes a chart can place, as bands over their dates. */
  renderDataNoteBands(
    shaded: readonly unknown[],
    options: DashboardDataNoteBandOptions,
  ): ReactNode;
  /** Whether a table's session cells link to their replays. */
  sessionReplays: boolean;
}

const NO_NOTES: readonly unknown[] = [];
const NO_NOTE_LAYOUT = { shaded: NO_NOTES, unplaced: NO_NOTES };
const EDGE_MARGIN: DashboardChartMargin = {
  top: CHART_EDGE,
  right: CHART_EDGE,
  bottom: CHART_EDGE,
  left: CHART_EDGE,
};
const ignoreLabelRows = () => {};
const EDGE_MARGIN_LAYOUT = {
  margin: EDGE_MARGIN,
  onLabelRows: ignoreLabelRows,
};

const STORED_ROWS_HOST: DashboardPanelChartHost = {
  usePanelEvents: (panel) => panel.config?.events,
  usePanelDataNotes: () => NO_NOTES,
  useDataNoteLayout: () => NO_NOTE_LAYOUT,
  useDataNoteChartMargin: () => EDGE_MARGIN_LAYOUT,
  renderDataNoteLines: () => null,
  renderDataNoteBands: () => null,
  sessionReplays: false,
};

const DashboardPanelChartHostContext =
  createContext<DashboardPanelChartHost>(STORED_ROWS_HOST);

/** Gives the dashboard charts inside it the app's key dates, notes and links. Keep `value` constant: its hooks run inside every chart. */
export const DashboardPanelChartHostProvider =
  DashboardPanelChartHostContext.Provider;

export function useDashboardPanelChartHost(): DashboardPanelChartHost {
  return useContext(DashboardPanelChartHostContext);
}

export function usePanelEvents(
  panel: Pick<SqlPanel, "chartType" | "config">,
): unknown {
  return useDashboardPanelChartHost().usePanelEvents(panel);
}

export function usePanelDataNotes(
  panel: Pick<SqlPanel, "id" | "sql">,
): readonly unknown[] {
  return useDashboardPanelChartHost().usePanelDataNotes(panel);
}

export function useDataNoteLayout(
  notes: readonly unknown[],
  rows: readonly Record<string, unknown>[],
  xKey: string,
): { shaded: readonly unknown[]; unplaced: readonly unknown[] } {
  return useDashboardPanelChartHost().useDataNoteLayout(notes, rows, xKey);
}

export function useDataNoteChartMargin(shaded: readonly unknown[]): {
  margin: DashboardChartMargin;
  onLabelRows: (rows: number) => void;
} {
  return useDashboardPanelChartHost().useDataNoteChartMargin(shaded);
}

/** Draws the notes a chart can place, as bands over their dates. */
export function useRenderDataNoteBands(): (
  shaded: readonly unknown[],
  options: DashboardDataNoteBandOptions,
) => ReactNode {
  const host = useDashboardPanelChartHost();
  return (shaded, options) => host.renderDataNoteBands(shaded, options);
}

export function DataNoteLines({
  notes,
  panelId,
}: {
  notes: readonly unknown[];
  panelId: string;
}) {
  return useDashboardPanelChartHost().renderDataNoteLines(notes, panelId);
}
