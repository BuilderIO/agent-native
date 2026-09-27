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

export const MIN_CALENDAR_DAYS = 1;
export const MAX_CALENDAR_DAYS = 31;
export const DEFAULT_CALENDAR_DAYS = 7;

export type CalendarColorSourceKey = string;

export interface CalendarViewPreferences {
  hideWeekends: boolean;
  numberOfDays: number;
  showDeclinedEvents: boolean;
  showWeekNumbers: boolean;
  /** @deprecated kept for back-compat migration; use accountColorModes */
  colorMode: CalendarColorMode;
  /** @deprecated kept for back-compat migration; use accountColors */
  singleColor: string;
  accountColorModes: Record<CalendarColorSourceKey, CalendarColorMode>;
  accountColors: Record<CalendarColorSourceKey, string>;
  googleCalendarVisibility: Record<string, boolean>;
  googleCalendarColors: Record<string, string>;
}

export const DEFAULT_CALENDAR_VIEW_PREFERENCES: CalendarViewPreferences = {
  hideWeekends: false,
  numberOfDays: DEFAULT_CALENDAR_DAYS,
  showDeclinedEvents: true,
  showWeekNumbers: false,
  colorMode: "multi",
  singleColor: CALENDAR_COLORS[0],
  accountColorModes: {},
  accountColors: {},
  googleCalendarVisibility: {},
  googleCalendarColors: {},
};

export function normalizeNumberOfDays(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(MAX_CALENDAR_DAYS, Math.max(MIN_CALENDAR_DAYS, value))
    : DEFAULT_CALENDAR_DAYS;
}

export function isEventVisibleForDeclinedPreference(
  responseStatus: string | undefined,
  showDeclinedEvents: boolean,
): boolean {
  return showDeclinedEvents || responseStatus !== "declined";
}

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

function normalizeBooleanRecord(input: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

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
    googleCalendarVisibility: {},
    googleCalendarColors: {},
  };
  if (!input || typeof input !== "object") return next;

  if (typeof input.hideWeekends === "boolean") {
    next.hideWeekends = input.hideWeekends;
  }
  next.numberOfDays = normalizeNumberOfDays(input.numberOfDays);
  if (typeof input.showDeclinedEvents === "boolean") {
    next.showDeclinedEvents = input.showDeclinedEvents;
  }
  if (typeof input.showWeekNumbers === "boolean") {
    next.showWeekNumbers = input.showWeekNumbers;
  }
  if (isValidCalendarColorMode(input.colorMode)) {
    next.colorMode = input.colorMode;
  }
  if (isValidCalendarColor(input.singleColor)) {
    next.singleColor = input.singleColor.trim();
  }
  next.accountColorModes = normalizeColorModeRecord(input.accountColorModes);
  next.accountColors = normalizeColorRecord(input.accountColors);
  next.googleCalendarVisibility = normalizeBooleanRecord(
    input.googleCalendarVisibility,
  );
  next.googleCalendarColors = normalizeColorRecord(input.googleCalendarColors);
  return next;
}

export function calendarViewPreferencesEqual(
  a: CalendarViewPreferences,
  b: CalendarViewPreferences,
): boolean {
  return (
    a.hideWeekends === b.hideWeekends &&
    a.numberOfDays === b.numberOfDays &&
    a.showDeclinedEvents === b.showDeclinedEvents &&
    a.showWeekNumbers === b.showWeekNumbers &&
    a.colorMode === b.colorMode &&
    a.singleColor === b.singleColor &&
    recordsEqual(a.accountColorModes, b.accountColorModes) &&
    recordsEqual(a.accountColors, b.accountColors) &&
    booleanRecordsEqual(
      a.googleCalendarVisibility,
      b.googleCalendarVisibility,
    ) &&
    recordsEqual(a.googleCalendarColors, b.googleCalendarColors)
  );
}

function booleanRecordsEqual(
  a: Record<string, boolean>,
  b: Record<string, boolean>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
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
