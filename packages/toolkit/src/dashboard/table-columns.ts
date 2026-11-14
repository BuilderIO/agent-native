import type {
  ColumnFormat,
  TableColumnConfig,
} from "../app/pages/adhoc/sql-dashboard/types";

const NUMBER_COLUMN_FORMATS: ReadonlySet<ColumnFormat> = new Set([
  "number",
  "currency",
  "percent",
  "delta",
  "duration",
]);

// A number, maybe with a sign, a currency sign before it, or a short unit
// after it: "-3.1", "$1,200", "12%", "3 PRs", "1.2K", "4.8 days".
const QUANTITY =
  /^([-+]?)([$€£¥]?)(\d[\d,]*(?:\.\d+)?)\s?(%|[a-zA-Z]{1,8}\.?)?$/;

// Two or more number-and-unit parts: "1m 42s", "2 hours 5 min".
const COMPOUND = /^(?:\d+(?:\.\d+)?\s?[a-zA-Z]+\.?\s*){2,}$/;
const COMPOUND_PART = /(\d+(?:\.\d+)?)\s?([a-zA-Z]+)\.?/g;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Seconds in each unit a duration can be written in. Months and years use
// their average length, close enough to sort by.
const DURATION_UNITS = new Map<string, number>();
for (const [seconds, names] of [
  [0.001, ["ms", "msec", "msecs", "millisecond", "milliseconds"]],
  [1, ["s", "sec", "secs", "second", "seconds"]],
  [MINUTE, ["m", "min", "mins", "minute", "minutes"]],
  [HOUR, ["h", "hr", "hrs", "hour", "hours"]],
  [DAY, ["d", "day", "days"]],
  [7 * DAY, ["w", "wk", "wks", "week", "weeks"]],
  [30.436875 * DAY, ["mo", "mos", "month", "months"]],
  [365.2425 * DAY, ["y", "yr", "yrs", "year", "years"]],
] as const) {
  for (const name of names) DURATION_UNITS.set(name, seconds);
}

// Thousands, millions and billions: "1.2K", "$3M", "4bn".
const MAGNITUDES = new Map([
  ["k", 1e3],
  ["K", 1e3],
  ["M", 1e6],
  ["mn", 1e6],
  ["B", 1e9],
  ["bn", 1e9],
]);

// A capital M is millions, never minutes; with a currency sign, so is "m".
function durationSeconds(unit: string, money: boolean): number | undefined {
  if (money || unit === "M") return undefined;
  return DURATION_UNITS.get(unit.toLowerCase());
}

function magnitude(unit: string, money: boolean): number | undefined {
  return MAGNITUDES.get(money && unit === "m" ? "M" : unit);
}

// What a value's unit lets it sort against: "" for no unit ("12", "$5",
// "12%"), "seconds" for a duration, "K/M/B" for a magnitude, or the word
// itself, lowercased, such as "prs". A word never equals the first two:
// "seconds" reads as a duration, and words have no slash.
interface Reading {
  amount: number;
  unit: string;
}

function readQuantity(value: unknown): Reading | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? { amount: value, unit: "" } : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();

  if (COMPOUND.test(text)) {
    let seconds = 0;
    for (const [, amount = "", unit = ""] of text.matchAll(COMPOUND_PART)) {
      const size = durationSeconds(unit, false);
      if (size === undefined) return null;
      seconds += Number(amount) * size;
    }
    return { amount: seconds, unit: "seconds" };
  }

  const match = QUANTITY.exec(text);
  if (!match) return null;
  const [, sign, currency, digits = "", rawUnit = ""] = match;
  const amount = Number(digits.replace(/,/g, "")) * (sign === "-" ? -1 : 1);
  const unit = rawUnit.replace(/\.$/, "");
  const money = currency !== "";
  if (unit === "" || unit === "%") return { amount, unit: "" };
  const seconds = durationSeconds(unit, money);
  if (seconds !== undefined) {
    return { amount: amount * seconds, unit: "seconds" };
  }
  const scale = magnitude(unit, money);
  if (scale !== undefined) return { amount: amount * scale, unit: "K/M/B" };
  return { amount, unit: unit.toLowerCase() };
}

/**
 * The number a table value stands for: a finite number as it is, or text
 * that reads as one, such as "1,200", "$12.50", "12%", "3 PRs" or "1.2K".
 * Durations ("4.8 days", "1m 42s") come back in seconds, so "75 days" sorts
 * above "9.9 days". Anything else is null. Whether a column lines up and
 * sorts by these numbers is up to `numberTableColumns`.
 */
export function tableQuantity(value: unknown): number | null {
  return readQuantity(value)?.amount ?? null;
}

// Values that read as numbers in one unit: plain numbers plus all durations,
// all K, M and B magnitudes, or all one word. "3 PRs" and "12 PRs" compare,
// but "12 Jan" and "3 Feb", or "512 B" and "5 MB", don't.
function inOneUnit(values: unknown[]): boolean {
  let unit = "";
  for (const value of values) {
    const reading = readQuantity(value);
    if (!reading) return false;
    if (reading.unit === "") continue;
    if (unit !== "" && reading.unit !== unit) return false;
    unit = reading.unit;
  }
  return true;
}

// Blank text, or a lone dash such as "–", stands in for a missing value.
const MISSING = /^\s*[-–—]?\s*$/;

export function isNumericColumnFormat(format: ColumnFormat | undefined) {
  return format !== undefined && NUMBER_COLUMN_FORMATS.has(format);
}

/**
 * Columns a table right-aligns in tabular figures and sorts by number:
 * number formats, plus unformatted columns whose every value is a number or
 * reads as one in a single unit (see `tableQuantity`). A column set to text
 * stays left, whatever it holds.
 */
export function numberTableColumns(
  columns: TableColumnConfig[],
  rows: Record<string, unknown>[],
): Set<string> {
  return new Set(
    columns
      .filter((col) => {
        if (isNumericColumnFormat(col.format)) return true;
        if (col.format) return false;
        const values = rows
          .map((row) => row[col.key])
          .filter(
            (value) =>
              value != null &&
              !(typeof value === "string" && MISSING.test(value)),
          );
        return values.length > 0 && inOneUnit(values);
      })
      .map((col) => col.key),
  );
}
