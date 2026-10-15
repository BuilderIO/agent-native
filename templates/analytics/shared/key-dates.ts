import type {
  DashboardAnnotations,
  PanelEvent,
  SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";
import { LEGACY_CHART_TYPE_ALIASES } from "./panel-render-contract";

export interface KeyDate {
  id: string;
  setId: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  time?: string;
  /** IANA zone for `time` */
  timeZone?: string;
  label: string;
  addedBy: string;
  updatedAt: string;
}

export interface KeyDateSet {
  id: string;
  name: string;
  createdBy: string;
  updatedAt: string;
  dates: KeyDate[];
}

/** The chart types that draw key dates: the same ones that accept a panel's own `events`. */
export const KEY_DATE_CHART_TYPES: ReadonlySet<SqlPanel["chartType"]> = new Set(
  ["line", "area", "bar", "combo"],
);

const MAX_HIDDEN_SETS = 100;

/** Key dates from every set the dashboard has not hidden, as chart events. */
export function keyDateEvents(
  sets: readonly Pick<KeyDateSet, "id" | "dates">[],
  annotations?: DashboardAnnotations,
): PanelEvent[] {
  const hidden = new Set(annotations?.hiddenKeyDateSets);
  return sets
    .filter((set) => !hidden.has(set.id))
    .flatMap((set) =>
      set.dates.map(({ date, time, timeZone, label }) => ({
        date,
        label,
        ...(time ? { time } : {}),
        ...(timeZone ? { timeZone } : {}),
      })),
    );
}

const eventKey = (event: PanelEvent) =>
  [event.date, event.time, event.timeZone, event.label].join("|");

/**
 * A panel's own events plus the dashboard's key dates, for chart types that
 * draw them. A key date the panel already lists is not added twice.
 */
export function panelEventsWithKeyDates(
  panel: Pick<SqlPanel, "chartType" | "config">,
  keyDates: readonly PanelEvent[],
): unknown {
  const own = panel.config?.events;
  const chartType =
    LEGACY_CHART_TYPE_ALIASES[panel.chartType] ?? panel.chartType;
  if (keyDates.length === 0 || !KEY_DATE_CHART_TYPES.has(chartType)) {
    return own;
  }
  const ownEvents: unknown[] = Array.isArray(own) ? own : [];
  const seen = new Set(
    ownEvents.flatMap((event) =>
      event && typeof event === "object" && "date" in event
        ? [eventKey(event as PanelEvent)]
        : [],
    ),
  );
  return [
    ...ownEvents,
    ...keyDates.filter((event) => !seen.has(eventKey(event))),
  ];
}

/** Why `config.annotations` is invalid, or null when it is valid or absent. */
export function dashboardAnnotationsIssue(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "config.annotations must be an object like { hiddenKeyDateSets: [setId, ...] }";
  }
  const { hiddenKeyDateSets, ...rest } = value as Record<string, unknown>;
  const unknownKeys = Object.keys(rest);
  if (unknownKeys.length > 0) {
    return `config.annotations has unknown keys: ${unknownKeys.join(", ")}. Supported: hiddenKeyDateSets`;
  }
  if (
    hiddenKeyDateSets !== undefined &&
    (!Array.isArray(hiddenKeyDateSets) ||
      hiddenKeyDateSets.length > MAX_HIDDEN_SETS ||
      hiddenKeyDateSets.some(
        (id) => typeof id !== "string" || id.trim() === "",
      ))
  ) {
    return `config.annotations.hiddenKeyDateSets must be an array of up to ${MAX_HIDDEN_SETS} key-date set ids from list-key-dates`;
  }
  return null;
}
