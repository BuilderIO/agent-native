import {
  FALLBACK_READER_LOCALE,
  formatLocaleDate,
} from "@agent-native/toolkit/app/shared/reader-locale";

/**
 * A search date filter is not a preset list: the reference's filter row is an
 * editable date field with its own picker popover and relative-date shortcuts
 * (original FilterRowDatetimeInput, which enables both the relative and the
 * extended-shortcut pickers), so a reader can name an exact day or range. These
 * rules turn the two typed dates into the bounds the search uses, and name the
 * selection back to the reader.
 */

export type CustomDateRange = {
  /** yyyy-mm-dd of the first day included. */
  from: string;
  /** yyyy-mm-dd of the last day included. */
  to: string;
};

/**
 * The reference's date filter offers three modes, in its own order and with its own copy:
 * "After", "Before", "Between", with "After" chosen first. After/Before take one day;
 * Between takes a first and a last day.
 */
export type CustomDateMode = "after" | "before" | "between";

export const CUSTOM_DATE_MODES: ReadonlyArray<{
  mode: CustomDateMode;
  label: string;
}> = [
  { mode: "after", label: "After" },
  { mode: "before", label: "Before" },
  { mode: "between", label: "Between" },
];

/**
 * The date filter's field selector names which column the picked days narrow: the
 * reference offers "Last edited" and "Created", in that order, with "Last edited"
 * chosen first.
 */
export type CustomDateField = "lastEdited" | "created";

export const CUSTOM_DATE_FIELDS: ReadonlyArray<{
  field: CustomDateField;
  label: string;
}> = [
  { field: "lastEdited", label: "Last edited" },
  { field: "created", label: "Created" },
];

export const DEFAULT_DATE_FIELD: CustomDateField = "lastEdited";

/** The selector's own name for a field, and the first one when it is unknown. */
const FIRST_DATE_FIELD_LABEL = CUSTOM_DATE_FIELDS[0]?.label ?? "Last edited";

export function customDateFieldLabel(field: CustomDateField): string {
  return (
    CUSTOM_DATE_FIELDS.find((entry) => entry.field === field)?.label ??
    FIRST_DATE_FIELD_LABEL
  );
}

export type RangeBounds = {
  sinceMs: number;
  untilMs: number;
  label: string;
};

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: string | null | undefined): value is string {
  if (!value || !ISO_DAY.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

/** Month/day as the filter label shows them, in the reader's own locale. */
export function dayLabel(
  value: string,
  locale: string = FALLBACK_READER_LOCALE,
): string {
  if (!isIsoDay(value)) return value;
  return formatLocaleDate(`${value}T00:00:00Z`, locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A day as the filter names it back: "11/1/2026", the picker's own numeric order. */
export function shortDayLabel(
  value: string,
  locale: string = FALLBACK_READER_LOCALE,
): string {
  if (!isIsoDay(value)) return value;
  return formatLocaleDate(`${value}T00:00:00Z`, locale, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The filter's own label for a picked day or range, in the reference's shape:
 * "<field> after 11/1/2026", "<field> before 11/1/2026" or
 * "<field> 11/1/2026 - 11/13/2026", and "Date" before anything is picked.
 */
export function customDateLabel(
  range: CustomDateRange | null,
  mode: CustomDateMode,
  field: string = FIRST_DATE_FIELD_LABEL,
  locale: string = FALLBACK_READER_LOCALE,
): string {
  const from = range?.from && isIsoDay(range.from) ? range.from : null;
  const to = range?.to && isIsoDay(range.to) ? range.to : null;
  if (mode === "between") {
    if (!from || !to) return "Date";
    return `${field} ${shortDayLabel(from, locale)} - ${shortDayLabel(to, locale)}`;
  }
  const day = from ?? to;
  if (!day) return "Date";
  return `${field} ${mode} ${shortDayLabel(day, locale)}`;
}

/**
 * Bounds for a typed range. A single day is a valid range (the reference allows
 * one), the order is forgiving, and the end day is inclusive to its last ms.
 */
export function customRangeBounds(
  range: CustomDateRange | null,
  locale: string = FALLBACK_READER_LOCALE,
  mode: CustomDateMode = "between",
): RangeBounds | { error: string } | null {
  if (!range) return null;
  const { from, to } = range;
  if (!from.trim() && !to.trim()) return null;
  if (mode !== "between") {
    // After/Before name one day: the typed start is used, and the end field is ignored, so a reader
    // switching modes does not have to clear a stale second date.
    const day = from.trim() || to.trim();
    if (!isIsoDay(day)) return { error: "Choose a date." };
    const start = Date.parse(`${day}T00:00:00Z`);
    return mode === "after"
      ? {
          sinceMs: start,
          untilMs: Number.MAX_SAFE_INTEGER,
          label: `After ${dayLabel(day, locale)}`,
        }
      : {
          sinceMs: 0,
          untilMs: start + DAY_MS - 1,
          label: `Before ${dayLabel(day, locale)}`,
        };
  }
  if (!isIsoDay(from) || !isIsoDay(to)) {
    return { error: "Choose a start and end date." };
  }
  const startDay = from <= to ? from : to;
  const endDay = from <= to ? to : from;
  const sinceMs = Date.parse(`${startDay}T00:00:00Z`);
  const untilMs = Date.parse(`${endDay}T00:00:00Z`) + DAY_MS - 1;
  return {
    sinceMs,
    untilMs,
    label:
      startDay === endDay
        ? dayLabel(startDay, locale)
        : `${dayLabel(startDay, locale)} – ${dayLabel(endDay, locale)}`,
  };
}

/** True when an ISO timestamp falls inside the bounds, end day included. */
export function withinRange(
  timestamp: string | number,
  bounds: Pick<RangeBounds, "sinceMs" | "untilMs">,
): boolean {
  const at =
    typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  return Number.isFinite(at) && at >= bounds.sinceMs && at <= bounds.untilMs;
}

/** The search action's own transport shape for a typed range. */
export function customRangeParams(
  range: CustomDateRange | null,
  mode: CustomDateMode = "between",
): {
  dateFrom: string | null;
  dateTo: string | null;
} {
  if (range && mode !== "between") {
    const day = (range.from.trim() || range.to.trim()).trim();
    if (!isIsoDay(day)) return { dateFrom: null, dateTo: null };
    return mode === "after"
      ? { dateFrom: day, dateTo: null }
      : { dateFrom: null, dateTo: day };
  }
  const bounds = customRangeBounds(range);
  if (!bounds || "error" in bounds) return { dateFrom: null, dateTo: null };
  return {
    dateFrom: new Date(bounds.sinceMs).toISOString(),
    dateTo: new Date(bounds.untilMs).toISOString(),
  };
}

/** True when the pick names a usable day, or both ends of a range. */
export function rangeIsComplete(
  range: CustomDateRange | null,
  mode: CustomDateMode,
): boolean {
  if (!range) return false;
  const hasFrom = isIsoDay(range.from);
  const hasTo = isIsoDay(range.to);
  return mode === "between" ? hasFrom && hasTo : hasFrom || hasTo;
}
