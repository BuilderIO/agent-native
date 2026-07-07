export const CALENDAR_VIEW_PREFERENCES_KEY = "calendar-view-preferences";
export const CALENDAR_COLOR_MODE_KEY = "calendar-color-mode";
export const CALENDAR_SINGLE_COLOR_KEY = "calendar-single-color";
export const CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT =
  "calendar:view-preferences-change";

export const CALENDAR_COLORS = [
  "#5B9BD5",
  "#7C9C6B",
  "#B07CC6",
  "#D4A053",
  "#CD6B6B",
  "#4ECDC4",
  "#8B8FA3",
] as const;

export type CalendarColorMode = "multi" | "single";

/** Account-scoped key: a Google account email, or `"ics:<externalCalendarId>"`. */
export type CalendarColorSourceKey = string;

export interface CalendarViewPreferences {
  hideWeekends: boolean;
  /** @deprecated kept for back-compat migration; use accountColorModes */
  colorMode: CalendarColorMode;
  /** @deprecated kept for back-compat migration; use accountColors */
  singleColor: string;
  /** Per-account color mode ("multi" = color by meeting type, "single" = fixed color) */
  accountColorModes: Record<CalendarColorSourceKey, CalendarColorMode>;
  /** Per-account fixed color, used when that account's mode is "single" */
  accountColors: Record<CalendarColorSourceKey, string>;
}

export const DEFAULT_CALENDAR_VIEW_PREFERENCES: CalendarViewPreferences = {
  hideWeekends: false,
  colorMode: "multi",
  singleColor: CALENDAR_COLORS[0],
  accountColorModes: {},
  accountColors: {},
};

export function isValidCalendarColorMode(
  value: unknown,
): value is CalendarColorMode {
  return value === "multi" || value === "single";
}

export function isValidCalendarColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function normalizeColorModeRecord(
  input: unknown,
): Record<CalendarColorSourceKey, CalendarColorMode> {
  const out: Record<CalendarColorSourceKey, CalendarColorMode> = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isValidCalendarColorMode(value)) out[key] = value;
  }
  return out;
}

function normalizeColorRecord(
  input: unknown,
): Record<CalendarColorSourceKey, string> {
  const out: Record<CalendarColorSourceKey, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isValidCalendarColor(value)) out[key] = value.trim();
  }
  return out;
}

/**
 * Returns a stable default color for an account that hasn't picked one yet,
 * cycling through the shared palette by the account's position in `keys` so
 * distinct accounts default to distinct swatches.
 */
export function defaultColorForAccount(
  accountKey: CalendarColorSourceKey,
  allKeysInOrder: CalendarColorSourceKey[],
): string {
  const index = Math.max(0, allKeysInOrder.indexOf(accountKey));
  return CALENDAR_COLORS[index % CALENDAR_COLORS.length];
}

export function normalizeCalendarViewPreferences(
  input: Partial<CalendarViewPreferences> | null | undefined,
): CalendarViewPreferences {
  const next = {
    ...DEFAULT_CALENDAR_VIEW_PREFERENCES,
    accountColorModes: {},
    accountColors: {},
  };
  if (!input || typeof input !== "object") return next;

  if (typeof input.hideWeekends === "boolean") {
    next.hideWeekends = input.hideWeekends;
  }
  if (isValidCalendarColorMode(input.colorMode)) {
    next.colorMode = input.colorMode;
  }
  if (isValidCalendarColor(input.singleColor)) {
    next.singleColor = input.singleColor.trim();
  }
  next.accountColorModes = normalizeColorModeRecord(input.accountColorModes);
  next.accountColors = normalizeColorRecord(input.accountColors);
  return next;
}

export function calendarViewPreferencesEqual(
  a: CalendarViewPreferences,
  b: CalendarViewPreferences,
): boolean {
  return (
    a.hideWeekends === b.hideWeekends &&
    a.colorMode === b.colorMode &&
    a.singleColor === b.singleColor &&
    recordsEqual(a.accountColorModes, b.accountColorModes) &&
    recordsEqual(a.accountColors, b.accountColors)
  );
}

function recordsEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}
