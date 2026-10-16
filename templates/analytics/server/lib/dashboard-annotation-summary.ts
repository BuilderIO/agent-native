import { resolveDefaultFilterVars } from "../../app/pages/adhoc/sql-dashboard/filter-vars.js";
import {
  panelTimeRange,
  type PanelTimeRange,
} from "../../app/pages/adhoc/sql-dashboard/interpolate.js";
import type {
  DashboardAnnotations,
  SqlPanel,
} from "../../app/pages/adhoc/sql-dashboard/types";
import {
  dataNoteAppliesTo,
  dataNoteInRange,
  panelDrawsDataNotes,
  RECENT_DATA_NOTE_DAYS,
  type DataNote,
} from "../../shared/data-notes.js";
import {
  drawsKeyDates,
  isKeyDateChartType,
  type KeyDate,
  type KeyDateSet,
} from "../../shared/key-dates.js";
import { panelEventInstant } from "../../shared/panel-events.js";

/** Latest dates listed per set; `dateCount` says how many there are, and `list-key-dates` has them all. */
export const SUMMARY_DATES_PER_SET = 5;

export interface KeyDateSetSummary {
  id: string;
  name: string;
  /** False when this dashboard hides the set. True draws nothing when the summary has `keyDatesHint`. */
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
  /**
   * Charts on this dashboard the note is on. A time chart draws it only over
   * the dates it plots, so not at all when they miss the note's; any other
   * chart, and a time chart whose x values aren't dates, lists it only when
   * its dates overlap the chart's time range. The server never sees x values,
   * so this can't promise a mark.
   */
  panelIds: string[];
  /** Charts the note belongs on that this dashboard hides it from. */
  hiddenOnPanelIds?: string[];
}

export interface DashboardAnnotationSummary {
  keyDateSets: KeyDateSetSummary[];
  /** Set when no chart on this dashboard can draw a key date. */
  keyDatesHint?: string;
  dataNotes: DataNoteSummary[];
  /** Set when they are another organization's, which the caller can't change. */
  editable?: false;
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

const NO_KEY_DATE_CHARTS =
  "This dashboard has no line, area, bar or combo charts, so no chart here draws key dates.";

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

type PlacedNote = Pick<
  DataNote,
  "startDate" | "endDate" | "matchEvents" | "unlessEvents" | "panels"
>;

function panelsWithNote(
  note: PlacedNote,
  dashboardId: string,
  panels: readonly SqlPanel[],
): SqlPanel[] {
  return panels.filter(
    (panel) =>
      panelDrawsDataNotes(panel) && dataNoteAppliesTo(note, dashboardId, panel),
  );
}

/**
 * As `SqlChartCard` does: a chart shows a note only when its dates overlap
 * the chart's time range. Without one, a time chart shades the note over
 * whatever dates its query returns, and another chart lists it while it is
 * recent. The chart type stands in for the x-axis, which the server never
 * sees. `vars` are undefined when the dashboard's filters can't be read, so no
 * chart's range can be.
 */
function panelsShowingNote(
  note: PlacedNote,
  dashboardId: string,
  panels: readonly SqlPanel[],
  vars: Record<string, string> | undefined,
  now: number,
): SqlPanel[] {
  return panelsWithNote(note, dashboardId, panels).filter((panel) => {
    const range: PanelTimeRange = vars
      ? panelTimeRange(panel, vars, now)
      : { kind: "unreadable" };
    if (isKeyDateChartType(panel.chartType) && range.kind !== "days") {
      return true;
    }
    return dataNoteInRange(note, range, now);
  });
}

/** By the instant each happened in its own zone; a date without a time counts from midnight UTC. */
function newestFirst(dates: readonly KeyDate[]): KeyDate[] {
  return dates
    .map((date) => ({ date, at: panelEventInstant(date) }))
    .sort((a, b) => b.at - a.at)
    .map(({ date }) => date);
}

/**
 * The key-date sets and data notes a dashboard's charts draw, for an agent
 * explaining them. `searchParams` are the page's URL filters; without them
 * the charts show the dashboard's default time range.
 */
export function summarizeDashboardAnnotations(
  dashboardId: string,
  config: Record<string, unknown>,
  sets: readonly KeyDateSet[],
  notes: readonly DataNote[],
  {
    now = Date.now(),
    searchParams,
  }: { now?: number; searchParams?: Record<string, string> } = {},
): DashboardAnnotationSummary {
  const panels = configPanels(config);
  const annotations = configAnnotations(config);
  const vars = resolveDefaultFilterVars(config, searchParams);
  const hiddenSets = new Set(annotations?.hiddenKeyDateSets);
  return {
    keyDateSets: sets.map((set) => ({
      id: set.id,
      name: set.name,
      shown: !hiddenSets.has(set.id),
      dateCount: set.dates.length,
      recentDates: newestFirst(set.dates)
        .slice(0, SUMMARY_DATES_PER_SET)
        .map(({ date, time, timeZone, label }) => ({
          date,
          ...(time ? { time } : {}),
          ...(timeZone ? { timeZone } : {}),
          label,
        })),
    })),
    ...(sets.length > 0 && !drawsKeyDates(panels)
      ? { keyDatesHint: NO_KEY_DATE_CHARTS }
      : {}),
    dataNotes: notes.flatMap((note) => {
      const reached = panelsShowingNote(note, dashboardId, panels, vars, now);
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

/**
 * Which charts on one dashboard a saved data note is on, as `panelIds` above
 * at the dashboard's default time range, with a hint when it is on none.
 */
export function dataNotePlacement(
  note: Pick<
    DataNote,
    "id" | "startDate" | "endDate" | "matchEvents" | "unlessEvents" | "panels"
  >,
  dashboardId: string,
  config: Record<string, unknown>,
  now: number = Date.now(),
) {
  const panels = configPanels(config);
  const belongs = panelsWithNote(note, dashboardId, panels);
  const reached = panelsShowingNote(
    note,
    dashboardId,
    panels,
    resolveDefaultFilterVars(config),
    now,
  );
  const hidden = hiddenPanelIds(configAnnotations(config), note.id);
  const shownOn = reached.filter((panel) => !hidden.has(panel.id));
  const hiddenOn = reached.filter((panel) => hidden.has(panel.id));
  // A note can be hidden on its time charts and outside the others' time
  // range, so each reason it shows nowhere is its own sentence.
  const reasons = [
    hiddenOn.length > 0 &&
      "This dashboard hides the note on the charts that would draw it (config.annotations.hiddenDataNotes). Tell the person rather than unhiding it on your own.",
    belongs.length > reached.length &&
      `Its charts here show a note only when its dates overlap their time range (the dashboard's default here), so a range that covers them shows it; a chart other than line, area, bar or combo whose SQL has no time range, or one the app can't read such as a quarter its SQL works out, lists it only while it is ongoing or for ${RECENT_DATA_NOTE_DAYS} days after it ends.`,
  ].filter((reason): reason is string => typeof reason === "string");
  const hint =
    shownOn.length > 0
      ? undefined
      : reasons.length > 0
        ? reasons.join(" ")
        : "The note shows on none of this dashboard's charts: no chart's SQL filters on one of matchEvents without also filtering on one of unlessEvents, and no chart is pinned in panels. Read the charts' SQL with get-sql-dashboard panelIds and use the exact event name, or pin the charts with panels.";
  return {
    dashboardId,
    shownOn: shownOn.map(panelRef),
    ...(hiddenOn.length > 0 ? { hiddenOn: hiddenOn.map(panelRef) } : {}),
    ...(hint ? { hint } : {}),
  };
}

/**
 * Whether a dashboard shows a key date's set, with a hint when no chart there
 * can draw the date. A chart draws it only if its rows reach the date, and the
 * server never sees rows, so this must not claim any chart does.
 */
export function keyDatePlacement(
  setId: string,
  dashboardId: string,
  config: Record<string, unknown>,
) {
  const shown = !configAnnotations(config)?.hiddenKeyDateSets?.includes(setId);
  const hint = !shown
    ? "This dashboard hides the date's set (config.annotations.hiddenKeyDateSets), so its charts don't draw the date. Tell the person rather than showing the set on your own."
    : !drawsKeyDates(configPanels(config))
      ? NO_KEY_DATE_CHARTS
      : undefined;
  return {
    dashboardId,
    setShown: shown,
    ...(hint ? { hint } : {}),
  };
}
