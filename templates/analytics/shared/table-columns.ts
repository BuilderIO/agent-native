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

/**
 * The number a table value stands for, so tables can line it up and sort by
 * it: a finite number as it is, or text that reads as one, such as "1,200",
 * "$12.50", "12%", "3 PRs" or "1.2K". Durations ("4.8 days", "1m 42s") come
 * back in seconds, so "75 days" sorts above "9.9 days". Anything else is null.
 */
export function tableQuantity(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();

  if (COMPOUND.test(text)) {
    let seconds = 0;
    for (const [, amount = "", unit = ""] of text.matchAll(COMPOUND_PART)) {
      const size = durationSeconds(unit, false);
      if (size === undefined) return null;
      seconds += Number(amount) * size;
    }
    return seconds;
  }

  const match = QUANTITY.exec(text);
  if (!match) return null;
  const [, sign, currency, digits = "", rawUnit = ""] = match;
  const amount = Number(digits.replace(/,/g, "")) * (sign === "-" ? -1 : 1);
  const unit = rawUnit.replace(/\.$/, "");
  const money = currency !== "";
  return amount * (durationSeconds(unit, money) ?? magnitude(unit, money) ?? 1);
}

// Blank text, or a lone dash such as "–", stands in for a missing value.
const MISSING = /^\s*[-–—]?\s*$/;

export function isNumericColumnFormat(format: ColumnFormat | undefined) {
  return format !== undefined && NUMBER_COLUMN_FORMATS.has(format);
}

/**
 * Columns a table right-aligns in tabular figures: number formats, plus
 * unformatted columns whose every value is a number or reads as one (see
 * `tableQuantity`). A column set to text stays left, whatever it holds.
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
        return (
          values.length > 0 &&
          values.every((value) => tableQuantity(value) !== null)
        );
      })
      .map((col) => col.key),
  );
}
