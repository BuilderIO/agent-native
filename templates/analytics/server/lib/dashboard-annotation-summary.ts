import type {
  DashboardAnnotations,
  SqlPanel,
} from "../../app/pages/adhoc/sql-dashboard/types";
import { dataNoteAppliesTo, type DataNote } from "../../shared/data-notes.js";
import {
  KEY_DATE_CHART_TYPES,
  type KeyDate,
  type KeyDateSet,
} from "../../shared/key-dates.js";

/** Latest dates listed per set; `dateCount` says how many there are, and `list-key-dates` has them all. */
export const SUMMARY_DATES_PER_SET = 5;

export interface KeyDateSetSummary {
  id: string;
  name: string;
  /** False when this dashboard hides the set. */
  shown: boolean;
  dateCount: number;
  recentDates?: Array<Pick<KeyDate, "date" | "time" | "timeZone" | "label">>;
}

export interface DataNoteSummary {
  id: string;
  kind: DataNote["kind"];
  title: string;
  status: DataNote["status"];
  startDate?: string;
  endDate?: string;
  /** Charts on this dashboard that draw the note. */
  panelIds: string[];
  /** Charts the note belongs on that this dashboard hides it from. */
  hiddenOnPanelIds?: string[];
}

export interface DashboardAnnotationSummary {
  keyDateSets: KeyDateSetSummary[];
  dataNotes: DataNoteSummary[];
}

/** Why the summary is missing; never confuse it with a dashboard that has no annotations. */
export interface DashboardAnnotationsUnreadable {
  annotationsError: string;
}

function configPanels(config: Record<string, unknown>): SqlPanel[] {
  return Array.isArray(config.panels) ? (config.panels as SqlPanel[]) : [];
}

function configAnnotations(
  config: Record<string, unknown>,
): DashboardAnnotations | undefined {
  return config.annotations as DashboardAnnotations | undefined;
}

function hiddenPanelIds(
  annotations: DashboardAnnotations | undefined,
  noteId: string,
): Set<string> {
  return new Set(
    (annotations?.hiddenDataNotes ?? [])
      .filter((entry) => entry.noteId === noteId)
      .map((entry) => entry.panelId),
  );
}

const newestFirst = (a: KeyDate, b: KeyDate) =>
  `${b.date} ${b.time ?? ""}`.localeCompare(`${a.date} ${a.time ?? ""}`);

/** The key-date sets and data notes a dashboard's charts draw, for an agent explaining them. */
export function summarizeDashboardAnnotations(
  dashboardId: string,
  config: Record<string, unknown>,
  sets: readonly KeyDateSet[],
  notes: readonly DataNote[],
): DashboardAnnotationSummary {
  const panels = configPanels(config);
  const annotations = configAnnotations(config);
  const hiddenSets = new Set(annotations?.hiddenKeyDateSets);
  return {
    keyDateSets: sets.map((set) => ({
      id: set.id,
      name: set.name,
      shown: !hiddenSets.has(set.id),
      dateCount: set.dates.length,
      recentDates: [...set.dates]
        .sort(newestFirst)
        .slice(0, SUMMARY_DATES_PER_SET)
        .map(({ date, time, timeZone, label }) => ({
          date,
          ...(time ? { time } : {}),
          ...(timeZone ? { timeZone } : {}),
          label,
        })),
    })),
    dataNotes: notes.flatMap((note) => {
      const reached = panels.filter((panel) =>
        dataNoteAppliesTo(note, dashboardId, panel),
      );
      if (reached.length === 0) return [];
      const hidden = hiddenPanelIds(annotations, note.id);
      const hiddenOn = reached.filter((panel) => hidden.has(panel.id));
      return [
        {
          id: note.id,
          kind: note.kind,
          title: note.title,
          status: note.status,
          ...(note.startDate ? { startDate: note.startDate } : {}),
          ...(note.endDate ? { endDate: note.endDate } : {}),
          panelIds: reached
            .filter((panel) => !hidden.has(panel.id))
            .map((panel) => panel.id),
          ...(hiddenOn.length > 0
            ? { hiddenOnPanelIds: hiddenOn.map((panel) => panel.id) }
            : {}),
        },
      ];
    }),
  };
}

type PanelRef = { panelId: string; title: string };

const panelRef = (panel: SqlPanel): PanelRef => ({
  panelId: panel.id,
  title: panel.title,
});

/** Where a saved data note draws on one dashboard, with a hint when that is nowhere. */
export function dataNotePlacement(
  note: Pick<DataNote, "id" | "matchEvents" | "unlessEvents" | "panels">,
  dashboardId: string,
  config: Record<string, unknown>,
) {
  const reached = configPanels(config).filter((panel) =>
    dataNoteAppliesTo(note, dashboardId, panel),
  );
  const hidden = hiddenPanelIds(configAnnotations(config), note.id);
  const shownOn = reached.filter((panel) => !hidden.has(panel.id));
  const hiddenOn = reached.filter((panel) => hidden.has(panel.id));
  const hint =
    shownOn.length > 0
      ? undefined
      : hiddenOn.length > 0
        ? "This dashboard hides the note on every chart it belongs on (config.annotations.hiddenDataNotes). Tell the person rather than unhiding it on your own."
        : "The note shows on none of this dashboard's charts: no chart's SQL names one of matchEvents as a quoted string without also naming one of unlessEvents, and no chart is pinned in panels. Read the charts' SQL with get-sql-dashboard panelIds and use the exact event name, or pin the charts with panels.";
  return {
    dashboardId,
    shownOn: shownOn.map(panelRef),
    ...(hiddenOn.length > 0 ? { hiddenOn: hiddenOn.map(panelRef) } : {}),
    ...(hint ? { hint } : {}),
  };
}

/** Whether a dashboard draws a key date's set, with a hint when it doesn't. */
export function keyDatePlacement(
  setId: string,
  dashboardId: string,
  config: Record<string, unknown>,
) {
  const shown = !configAnnotations(config)?.hiddenKeyDateSets?.includes(setId);
  const canDraw = configPanels(config).some((panel) =>
    KEY_DATE_CHART_TYPES.has(panel.chartType),
  );
  const hint = !shown
    ? "This dashboard hides the date's set (config.annotations.hiddenKeyDateSets), so its charts don't draw the date. Tell the person rather than showing the set on your own."
    : !canDraw
      ? "This dashboard has no line, area, bar or combo charts, so no chart here draws the date."
      : undefined;
  return {
    dashboardId,
    setShown: shown,
    ...(hint ? { hint } : {}),
  };
}
