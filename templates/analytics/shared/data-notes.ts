import type {
  DashboardAnnotations,
  SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";
import { xInstant } from "./panel-events";

export const DATA_NOTE_KINDS = ["data", "incident"] as const;
export type DataNoteKind = (typeof DATA_NOTE_KINDS)[number];

export const DATA_NOTE_STATUSES = ["open", "fixed"] as const;
export type DataNoteStatus = (typeof DATA_NOTE_STATUSES)[number];

/** A chart the note belongs on whatever its SQL counts. */
export interface DataNotePanelRef {
  dashboardId: string;
  panelId: string;
}

export interface DataNote {
  id: string;
  /** "data" for tracking problems (undercounts, gaps, renamed events); "incident" for product outages. */
  kind: DataNoteKind;
  title: string;
  note: string;
  /** "YYYY-MM-DD"; absent when the problem has no known start. */
  startDate?: string;
  /** "YYYY-MM-DD", inclusive; absent while the problem is ongoing. */
  endDate?: string;
  status: DataNoteStatus;
  /** What fixed it, once `status` is "fixed". */
  fix?: string;
  /** The note shows on charts whose SQL counts any of these event names... */
  matchEvents: string[];
  /** ...unless the SQL also counts one of these, which covers the gap. */
  unlessEvents: string[];
  /** Charts the note shows on regardless of their SQL. */
  panels: DataNotePanelRef[];
  addedBy: string;
  updatedAt: string;
}

/** A chart without a date axis can't place a note, so it flags notes that are ongoing or ended this recently. */
export const RECENT_DATA_NOTE_DAYS = 30;

const DAY_MS = 86_400_000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the SQL names the event as a quoted string, the way a filter on it does. */
export function sqlCountsEvent(sql: string, event: string): boolean {
  const name = event.trim();
  if (!name) return false;
  return new RegExp(`(['"])${escapeRegExp(name)}\\1`, "i").test(sql);
}

export function dataNoteAppliesTo(
  note: Pick<DataNote, "matchEvents" | "unlessEvents" | "panels">,
  dashboardId: string,
  panel: Pick<SqlPanel, "id" | "sql">,
): boolean {
  if (
    note.panels.some(
      (ref) => ref.dashboardId === dashboardId && ref.panelId === panel.id,
    )
  ) {
    return true;
  }
  const sql = panel.sql ?? "";
  return (
    note.matchEvents.some((event) => sqlCountsEvent(sql, event)) &&
    !note.unlessEvents.some((event) => sqlCountsEvent(sql, event))
  );
}

/** The notes that belong on a panel, minus the ones this dashboard hides there. */
export function dataNotesForPanel(
  notes: readonly DataNote[],
  dashboardId: string,
  panel: Pick<SqlPanel, "id" | "sql">,
  annotations?: DashboardAnnotations,
): DataNote[] {
  const hidden = new Set(
    (annotations?.hiddenDataNotes ?? [])
      .filter((entry) => entry.panelId === panel.id)
      .map((entry) => entry.noteId),
  );
  return notes.filter(
    (note) =>
      !hidden.has(note.id) && dataNoteAppliesTo(note, dashboardId, panel),
  );
}

/** Ongoing, or ended within `RECENT_DATA_NOTE_DAYS` of `now`. */
export function dataNoteIsRecent(
  note: Pick<DataNote, "endDate">,
  now: number = Date.now(),
): boolean {
  if (!note.endDate) return true;
  return (
    Date.parse(note.endDate) + DAY_MS > now - RECENT_DATA_NOTE_DAYS * DAY_MS
  );
}

/** True when every x value reads as a date, so notes can be placed on the axis. */
export function xValuesAreDates(xValues: readonly unknown[]): boolean {
  return xValues.length > 0 && xValues.every((x) => xInstant(x) !== null);
}

export interface DataNoteBand {
  startIndex: number;
  endIndex: number;
  /** The note's start falls inside the chart, so its edge is drawn. */
  startEdge: boolean;
  /** The note's end falls inside the chart; an ongoing note has none. */
  endEdge: boolean;
}

/**
 * The run of x values a note covers. Each x value stands for the bucket up
 * to the next one, so a weekly point covers its whole week. Null when the
 * x axis is not dates or the note is outside it.
 */
export function resolveDataNoteBand(
  note: Pick<DataNote, "startDate" | "endDate">,
  xValues: readonly unknown[],
): DataNoteBand | null {
  if (!xValuesAreDates(xValues)) return null;
  const known = xValues.map(xInstant) as number[];
  const gaps = known
    .slice(1)
    .map((point, index) => point - known[index])
    .filter((gap) => gap > 0);
  const lastSpan = gaps.length ? Math.min(...gaps) : DAY_MS;
  const spanEnd = (index: number) =>
    index + 1 < known.length && known[index + 1] > known[index]
      ? known[index + 1]
      : known[index] + lastSpan;
  const start = note.startDate ? Date.parse(note.startDate) : -Infinity;
  const end = note.endDate ? Date.parse(note.endDate) + DAY_MS : Infinity;
  const covered = known.flatMap((point, index) =>
    point < end && spanEnd(index) > start ? [index] : [],
  );
  if (covered.length === 0) return null;
  const first = Math.min(...known);
  const last = Math.max(...known.map((_, index) => spanEnd(index)));
  return {
    startIndex: covered[0],
    endIndex: covered[covered.length - 1],
    startEdge: start >= first,
    endEdge: end <= last,
  };
}

export type DataNoteTone = "incident" | "data" | "fixed";

/** Incidents stay red; data problems are amber until fixed, then grey. */
export function dataNoteTone(note: Pick<DataNote, "kind" | "status">) {
  if (note.kind === "incident") return "incident";
  return note.status === "fixed" ? "fixed" : "data";
}

const MAX_HIDDEN_DATA_NOTES = 500;

/** Why `config.annotations.hiddenDataNotes` is invalid, or null when it is valid or absent. */
export function hiddenDataNotesIssue(value: unknown): string | null {
  if (value === undefined) return null;
  if (
    !Array.isArray(value) ||
    value.length > MAX_HIDDEN_DATA_NOTES ||
    value.some(
      (entry) =>
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        Object.keys(entry).some(
          (key) => key !== "noteId" && key !== "panelId",
        ) ||
        typeof entry.noteId !== "string" ||
        entry.noteId.trim() === "" ||
        typeof entry.panelId !== "string" ||
        entry.panelId.trim() === "",
    )
  ) {
    return `config.annotations.hiddenDataNotes must be an array of up to ${MAX_HIDDEN_DATA_NOTES} { noteId, panelId } pairs, noteId from list-data-notes and panelId from this dashboard`;
  }
  return null;
}

export interface DataNoteDates {
  /** "range" has both dates; "since" is an ongoing note; "until" has no known start. */
  kind: "range" | "since" | "until";
  text: string;
}

/** "Oct 9 – 13, 2026", or one date with how to read it; null when the note has no dates. */
export function formatDataNoteDates(
  note: Pick<DataNote, "startDate" | "endDate">,
  locale?: string,
): DataNoteDates | null {
  // formatRange shares the month and year: "Oct 9 – 13, 2026". The lib target predates its types.
  const format = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }) as Intl.DateTimeFormat & {
    formatRange(start: number, end: number): string;
  };
  if (note.startDate && note.endDate) {
    return {
      kind: "range",
      text: format.formatRange(
        Date.parse(note.startDate),
        Date.parse(note.endDate),
      ),
    };
  }
  if (note.startDate) {
    return { kind: "since", text: format.format(Date.parse(note.startDate)) };
  }
  if (note.endDate) {
    return { kind: "until", text: format.format(Date.parse(note.endDate)) };
  }
  return null;
}
