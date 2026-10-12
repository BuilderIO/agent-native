/** Approximate rendered width of `value` in the chart sans-serif font. */
export function estimateTextWidth(value: string, fontSize: number): number {
  let units = 0;
  for (const char of value) {
    if (char === " ") {
      units += 0.28;
    } else if (/[MW@#%&]/.test(char)) {
      units += 0.86;
    } else if (/[A-Z]/.test(char)) {
      units += 0.64;
    } else if (/[ilI.,:;|!']/u.test(char)) {
      units += 0.26;
    } else if (/[0-9]/.test(char)) {
      units += 0.56;
    } else {
      units += 0.54;
    }
  }
  return units * fontSize;
}

export function trimToWidth(
  value: string,
  fontSize: number,
  maxWidth: number,
  ellipsis = "...",
): string {
  if (estimateTextWidth(value, fontSize) <= maxWidth) return value;
  // One pass: a label can be a long URL and every category tick trims one.
  const room = maxWidth - estimateTextWidth(ellipsis, fontSize);
  let kept = "";
  let width = 0;
  for (const char of value) {
    width += estimateTextWidth(char, fontSize);
    if (width > room) break;
    kept += char;
  }
  kept = kept.trimEnd();
  return kept ? `${kept}${ellipsis}` : "";
}

const ISO_DATE_VALUE = /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}.*)?$/;
// YYYYMMDD, as GA4's BigQuery export writes `event_date`. Requiring a real month
// and day keeps an eight-digit id from passing as a date.
const COMPACT_DATE_VALUE =
  /^(19|20|21)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const PERIOD_VALUE = /^(\d{4}-?W\d{1,2}|\d{4}-?Q[1-4]|Q[1-4][ -]\d{4})$/i;
const MONTH =
  "(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\\.?";
const MONTH_NAME_DATE = new RegExp(
  `^(${MONTH}(\\s+\\d{1,2})?|\\d{1,2}\\s+${MONTH})(,?\\s+\\d{4})?$`,
  "i",
);

function isDateValue(value: unknown): boolean {
  if (value instanceof Date) return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  return (
    ISO_DATE_VALUE.test(text) ||
    PERIOD_VALUE.test(text) ||
    MONTH_NAME_DATE.test(text) ||
    COMPACT_DATE_VALUE.test(text)
  );
}

function isOrdinalAxisValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (isDateValue(value)) return true;
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  );
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * True when an x axis holds named categories rather than dates or numbers.
 * Date and number axes read fine with thinned ticks; a category axis loses
 * names when ticks are skipped.
 */
export function isCategoryAxis(values: readonly unknown[]): boolean {
  return values.some((value) => !isBlank(value) && !isOrdinalAxisValue(value));
}

/**
 * True when every x value is a date or period, so one end of the axis is the
 * newest data. Plain numbers are ids or buckets, not time.
 */
export function isDateAxis(values: readonly unknown[]): boolean {
  const present = values.filter((value) => !isBlank(value));
  return present.length > 0 && present.every(isDateValue);
}

// A timestamp with no offset reads as UTC, so the dashboard in any time zone and
// the emailed report agree on which end of an axis is newest.
const TIME_ZONE_SUFFIX = /(z|utc|[+-]\d{2}:?\d{2})$/i;

/** One UTC instant for every date format, so `20260930` sorts before `2026-10-01`. */
function sortableDate(text: string): string | null {
  const iso = COMPACT_DATE_VALUE.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`
    : text;
  const time = Date.parse(
    iso.length > 10 && !TIME_ZONE_SUFFIX.test(iso)
      ? `${iso.replace(" ", "T")}Z`
      : iso,
  );
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * `Sep 30, 2026`, `30 Sep 2026` or `September 2026` as a UTC instant. Parsed
 * here because `Date.parse` reads these differently in each browser; without a
 * year (`Oct 04`) there is no order to read.
 */
function sortableMonthNameDate(text: string): string | null {
  const year = /\d{4}$/.exec(text)?.[0];
  const month = MONTHS.indexOf(
    text.match(/[a-z]{3}/i)?.[0].toLowerCase() ?? "",
  );
  if (!year || month < 0) return null;
  const day = Number(/\b\d{1,2}\b/.exec(text.slice(0, -4))?.[0] ?? 1);
  const date = new Date(Date.UTC(Number(year), month, day));
  return date.getUTCDate() === day ? date.toISOString() : null;
}

function sortableAxisValue(value: unknown): number | string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (ISO_DATE_VALUE.test(text) || COMPACT_DATE_VALUE.test(text)) {
    return sortableDate(text);
  }
  if (MONTH_NAME_DATE.test(text)) return sortableMonthNameDate(text);
  const yearFirst = /^(\d{4})-?[WQ](\d{1,2})$/i.exec(text);
  if (yearFirst) return Number(yearFirst[1]) * 100 + Number(yearFirst[2]);
  const quarterFirst = /^Q([1-4])[ -](\d{4})$/i.exec(text);
  if (quarterFirst)
    return Number(quarterFirst[2]) * 100 + Number(quarterFirst[1]);
  return null;
}

/**
 * Which way an axis runs; null when its values cannot all be compared (month
 * names without a year, mixed types) or are out of order (a query sorted by count), so no end
 * is known to be the newest.
 */
export function axisDirection(
  values: readonly unknown[],
): "ascending" | "descending" | null {
  const sortable = values
    .filter((value) => !isBlank(value))
    .map(sortableAxisValue);
  const kind = typeof sortable[0];
  if (
    sortable.length === 0 ||
    sortable.some((value) => value === null || typeof value !== kind)
  ) {
    return null;
  }
  let rises = false;
  let falls = false;
  for (let index = 1; index < sortable.length; index++) {
    const previous = sortable[index - 1] as number | string;
    const current = sortable[index] as number | string;
    if (current > previous) rises = true;
    if (current < previous) falls = true;
  }
  if (rises && falls) return null;
  return falls ? "descending" : "ascending";
}

export interface CategoryAxisPlan {
  /** Tick rotation in degrees; 0 draws labels level. */
  angle: number;
  /** Labels skipped between drawn ones; 0 draws every label. */
  interval: number;
  /** Axis height that fits the drawn labels. */
  height: number;
  /** Width past which a label is cut with an ellipsis. */
  labelWidth: number;
}

const LEVEL_AXIS_HEIGHT = 30;
const LEVEL_LABEL_GAP = 6;
const AXIS_PADDING = 12;
const MAX_AXIS_HEIGHT = 96;
const MAX_LABEL_WIDTH = 120;
const ANGLES = [35, 60, 90];

/**
 * Lays out every category label under a plot: level when they fit, otherwise
 * angled as gently as their spacing allows, cut with an ellipsis past
 * `labelWidth`. `leftInset` is the room left of the plot; the first angled
 * label must not run off the chart edge.
 */
export function planCategoryAxis(
  labels: readonly string[],
  plotWidth: number,
  leftInset: number,
  fontSize: number,
): CategoryAxisPlan {
  const slot = plotWidth / Math.max(labels.length, 1);
  const widest = labels.reduce(
    (max, label) => Math.max(max, estimateTextWidth(label, fontSize)),
    0,
  );
  if (widest + LEVEL_LABEL_GAP <= slot) {
    return {
      angle: 0,
      interval: 0,
      height: LEVEL_AXIS_HEIGHT,
      labelWidth: slot,
    };
  }
  const angled = (degrees: number, interval: number): CategoryAxisPlan => {
    const radians = (degrees * Math.PI) / 180;
    const sin = Math.sin(radians);
    const cos = Math.cos(radians);
    const limits = [
      widest,
      MAX_LABEL_WIDTH,
      (MAX_AXIS_HEIGHT - AXIS_PADDING - fontSize * cos) / sin,
    ];
    if (cos > 0.05) limits.push((leftInset + slot / 2) / cos);
    const labelWidth = Math.max(fontSize, Math.min(...limits));
    return {
      angle: -degrees,
      interval,
      height: Math.ceil(labelWidth * sin + fontSize * cos + AXIS_PADDING),
      labelWidth,
    };
  };
  for (const degrees of ANGLES) {
    // Neighboring labels sit slot * sin(angle) apart; a line of text needs fontSize.
    if (slot * Math.sin((degrees * Math.PI) / 180) >= fontSize) {
      return angled(degrees, 0);
    }
  }
  return angled(90, Math.ceil(fontSize / Math.max(slot, 0.1)) - 1);
}
