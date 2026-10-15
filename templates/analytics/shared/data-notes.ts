import type {
  DashboardAnnotations,
  SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";
import { xBucketEnd, xCadence, xDatePoints, xInstant } from "./panel-events";

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

// A comment, a quoted string (a doubled or backslashed quote stays inside it),
// a backquoted name, a word, a run of comparison characters, or one character.
const SQL_TOKEN =
  /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:[^'\\]|''|\\[\s\S])*'|"(?:[^"\\]|""|\\[\s\S])*"|`[^`]*`|[\w$]+|[=<>!]+|\S/g;

const QUOTE_ESCAPE: Record<string, RegExp> = {
  "'": /\\([\s\S])|''/g,
  '"': /\\([\s\S])|""/g,
};

interface SqlToken {
  /** Upper-cased, except a quoted string's. */
  text: string;
  /** A quoted string's value, unescaped; null for any other token. */
  value: string | null;
}

/** The SQL's tokens, without its comments. */
function sqlTokens(sql: string): SqlToken[] {
  return [...sql.matchAll(SQL_TOKEN)].flatMap(([text]): SqlToken[] => {
    if (text.startsWith("--") || text.startsWith("/*")) return [];
    const quote = text[0];
    if (!QUOTE_ESCAPE[quote]) {
      return [{ text: text.toUpperCase(), value: null }];
    }
    const value = text
      .slice(1, -1)
      .replace(QUOTE_ESCAPE[quote], (_, escaped?: string) => escaped ?? quote);
    return [{ text, value }];
  });
}

const COMPARED_AFTER = new Set(["=", "LIKE", "ILIKE", "WHEN"]);

/**
 * The quoted values the SQL filters rows on: either side of `=`, in WHERE or
 * CASE WHEN alike, a LIKE pattern, a simple CASE's WHEN value, or an item of
 * an IN list. A value it selects, returns from THEN or ELSE, excludes with
 * `!=`, `<>`, or NOT, or only mentions in a comment does not count.
 */
function sqlFilterValues(sql: string): Set<string> {
  const tokens = sqlTokens(sql);
  const values = new Set<string>();
  // Whether each open parenthesis holds an IN list.
  const inList: boolean[] = [];
  tokens.forEach((token, index) => {
    const prev = tokens[index - 1]?.text;
    const next = tokens[index + 1]?.text;
    const negated = tokens[index - 2]?.text === "NOT";
    if (token.text === "(") inList.push(prev === "IN" && !negated);
    if (token.text === ")") inList.pop();
    if (token.value === null) return;
    const compared =
      (prev !== undefined && COMPARED_AFTER.has(prev) && !negated) ||
      next === "=";
    const listed =
      inList[inList.length - 1] === true &&
      (prev === "(" || prev === ",") &&
      (next === "," || next === ")");
    if (compared || listed) values.add(token.value);
  });
  return values;
}

function filtersOn(values: ReadonlySet<string>, event: string): boolean {
  const name = event.trim();
  return name !== "" && values.has(name);
}

/**
 * True when the SQL filters rows on the event name as a quoted value. Case
 * counts: SQL compares the values exactly, so 'Signup' and 'signup' are
 * different events.
 */
export function sqlCountsEvent(sql: string, event: string): boolean {
  return filtersOn(sqlFilterValues(sql), event);
}

function appliesTo(
  note: Pick<DataNote, "matchEvents" | "unlessEvents" | "panels">,
  dashboardId: string,
  panelId: string,
  filterValues: ReadonlySet<string>,
): boolean {
  if (
    note.panels.some(
      (ref) => ref.dashboardId === dashboardId && ref.panelId === panelId,
    )
  ) {
    return true;
  }
  return (
    note.matchEvents.some((event) => filtersOn(filterValues, event)) &&
    !note.unlessEvents.some((event) => filtersOn(filterValues, event))
  );
}

export function dataNoteAppliesTo(
  note: Pick<DataNote, "matchEvents" | "unlessEvents" | "panels">,
  dashboardId: string,
  panel: Pick<SqlPanel, "id" | "sql">,
): boolean {
  return appliesTo(
    note,
    dashboardId,
    panel.id,
    sqlFilterValues(panel.sql ?? ""),
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
  const filterValues = sqlFilterValues(panel.sql ?? "");
  return notes.filter(
    (note) =>
      !hidden.has(note.id) &&
      appliesTo(note, dashboardId, panel.id, filterValues),
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

/**
 * A date or timestamp string. Unlike a key date, a note can be open-ended, so
 * a numeric axis read as instants (hour of day, year) would be shaded whole.
 */
function xDateInstant(value: unknown): number | null {
  return typeof value === "string" ? xInstant(value) : null;
}

/** A blank bucket or a row label such as "Total", not a number. */
function isRowLabel(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return value.trim() === "" || !Number.isFinite(Number(value));
}

/**
 * True when notes can be placed on the axis: some x values are dates and the
 * rest are blank or labels such as a total row. Any number makes it a
 * numeric axis, which notes cannot be placed on.
 */
export function xValuesAreDates(xValues: readonly unknown[]): boolean {
  let dates = 0;
  for (const x of xValues) {
    if (xDateInstant(x) !== null) dates++;
    else if (!isRowLabel(x)) return false;
  }
  return dates > 0;
}

/** One run of adjacent rows a note covers. */
export interface DataNoteBand {
  startIndex: number;
  endIndex: number;
  /**
   * Draw an edge at startIndex: the date row before it is one the note does
   * not cover, or, at the chart's first date row, the note's start falls
   * inside the chart (its end on a newest-first axis).
   */
  startEdge: boolean;
  /** Draw an edge at endIndex: the same, after it and at the last date row. */
  endEdge: boolean;
}

interface DateAxis {
  /** Each date row with the time its x value stands for, from start up to end. */
  buckets: { row: number; start: number; end: number }[];
  start: number;
  end: number;
}

/** The chart's date rows by their position in xValues; null when the x axis is not dates. */
function dateAxis(xValues: readonly unknown[]): DateAxis | null {
  if (!xValuesAreDates(xValues)) return null;
  const points = xDatePoints(xValues, xDateInstant);
  const cadence = xCadence(points);
  const buckets = points.map(({ row, instant, day }) => {
    const start = cadence.unit === "time" ? instant : day;
    return { row, start, end: xBucketEnd(cadence, start) };
  });
  return {
    buckets,
    start: Math.min(...buckets.map((bucket) => bucket.start)),
    end: Math.max(...buckets.map((bucket) => bucket.end)),
  };
}

/** A note's days, from start up to end; a missing date leaves that side open. */
function noteSpan(note: Pick<DataNote, "startDate" | "endDate">) {
  return {
    start: note.startDate ? Date.parse(note.startDate) : -Infinity,
    end: note.endDate ? Date.parse(note.endDate) + DAY_MS : Infinity,
  };
}

/**
 * A run ends wherever the next row is not covered, so rows sorted by
 * something other than date shade only the rows in the note, never one
 * between them.
 */
function bandsOnAxis(
  note: Pick<DataNote, "startDate" | "endDate">,
  axis: DateAxis,
): DataNoteBand[] {
  const { start, end } = noteSpan(note);
  const { buckets } = axis;
  const covers = buckets.map(
    (bucket) => bucket.start < end && bucket.end > start,
  );
  const startInside = start >= axis.start;
  const endInside = end <= axis.end;
  const newestFirst = buckets[0].start > buckets[buckets.length - 1].start;
  const runs: { first: number; last: number }[] = [];
  covers.forEach((covered, i) => {
    if (!covered) return;
    const run = runs[runs.length - 1];
    if (
      run &&
      run.last === i - 1 &&
      buckets[i - 1].row === buckets[i].row - 1
    ) {
      run.last = i;
    } else {
      runs.push({ first: i, last: i });
    }
  });
  // Runs split only by a row whose x is not a date get no edge there: the note goes on.
  return runs.map(({ first, last }) => ({
    startIndex: buckets[first].row,
    endIndex: buckets[last].row,
    startEdge:
      first > 0 ? !covers[first - 1] : newestFirst ? endInside : startInside,
    endEdge:
      last < buckets.length - 1
        ? !covers[last + 1]
        : newestFirst
          ? startInside
          : endInside,
  }));
}

/**
 * The runs of x values a note covers, in row order. Each x value stands for
 * one step of the axis's cadence, so a weekly point covers its whole week
 * whichever way the rows are sorted, and a day the query returned no row for
 * belongs to no x value. Rows whose x is not a date (a null bucket, a total
 * row) are skipped. Empty when the x axis is not dates or no x value falls in
 * the note.
 */
export function resolveDataNoteBands(
  note: Pick<DataNote, "startDate" | "endDate">,
  xValues: readonly unknown[],
): DataNoteBand[] {
  const axis = dateAxis(xValues);
  return axis ? bandsOnAxis(note, axis) : [];
}

export interface ChartDataNote {
  note: DataNote;
  /** Empty when the note is written under the chart instead of shaded on it. */
  bands: DataNoteBand[];
}

/**
 * The notes a chart shows, in order. A date axis shades each note over the
 * x values it covers, writes one that falls only between them, on days the
 * query returned no row for, under the chart, and leaves off one outside its
 * dates. Any other axis writes the recent notes under the chart.
 */
export function dataNotesOnChart(
  notes: readonly DataNote[],
  xValues: readonly unknown[],
  now: number = Date.now(),
): ChartDataNote[] {
  const axis = dateAxis(xValues);
  if (!axis) {
    return notes
      .filter((note) => dataNoteIsRecent(note, now))
      .map((note) => ({ note, bands: [] }));
  }
  return notes.flatMap((note): ChartDataNote[] => {
    const bands = bandsOnAxis(note, axis);
    if (bands.length > 0) return [{ note, bands }];
    const { start, end } = noteSpan(note);
    return start < axis.end && end > axis.start ? [{ note, bands: [] }] : [];
  });
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
