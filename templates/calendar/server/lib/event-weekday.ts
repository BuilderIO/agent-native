const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

const WEEKDAY_ALIASES = new Map<string, WeekdayName>([
  ...WEEKDAY_NAMES.map((day) => [day, day] as const),
  ...WEEKDAY_NAMES.map((day) => [day.slice(0, 3), day] as const),
  ["tues", "tuesday"],
  ["thur", "thursday"],
  ["thurs", "thursday"],
  ["weekend", "saturday"],
]);

/**
 * Accepts the shapes a natural-language request arrives in — "Saturday",
 * "sat", "SUN", or an array/comma string mixing them — and rejects anything
 * else loudly. A silently dropped day name would delete a different set of
 * events than the user asked about.
 */
export function normalizeWeekdays(
  input: string | readonly string[] | undefined,
): WeekdayName[] {
  if (input === undefined) return [];
  const raw = (Array.isArray(input) ? input : String(input).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const resolved = new Set<WeekdayName>();
  for (const value of raw) {
    if (value === "weekend" || value === "weekends") {
      resolved.add("saturday");
      resolved.add("sunday");
      continue;
    }
    if (value === "weekday" || value === "weekdays") {
      for (const day of WEEKDAY_NAMES) {
        if (day !== "saturday" && day !== "sunday") resolved.add(day);
      }
      continue;
    }
    const match = WEEKDAY_ALIASES.get(value.replace(/s$/, ""));
    if (!match) {
      throw new Error(
        `Unrecognized day of week: ${value}. Use full or 3-letter English day names.`,
      );
    }
    resolved.add(match);
  }
  return WEEKDAY_NAMES.filter((day) => resolved.has(day));
}

/**
 * The weekday the user sees for an event, which is the weekday in the calendar
 * view's timezone — not UTC. A Sunday 5pm America/Los_Angeles meeting is Monday
 * in UTC, so filtering on the raw ISO string silently misses it and instead
 * deletes a Monday meeting the user never mentioned.
 *
 * All-day starts carry no instant, so their `YYYY-MM-DD` date IS the local day
 * and must not be re-projected through a timezone.
 */
export function eventWeekday(start: string, timezone: string): WeekdayName {
  if (DATE_ONLY_RE.test(start)) {
    const [year, month, day] = start.split("-").map(Number);
    return WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  }
  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid event start: ${start}`);
  }
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  })
    .format(parsed)
    .toLowerCase();
  const match = WEEKDAY_NAMES.find((day) => day === label);
  if (!match) throw new Error(`Unable to resolve weekday for ${start}`);
  return match;
}

export function matchesWeekdays(
  start: string,
  timezone: string,
  weekdays: readonly WeekdayName[],
): boolean {
  if (weekdays.length === 0) return true;
  return weekdays.includes(eventWeekday(start, timezone));
}
