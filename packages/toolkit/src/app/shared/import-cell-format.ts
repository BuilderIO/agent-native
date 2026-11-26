// Reading one imported cell under the format its own property declares.
//
// The class this module is the shared boundary for: an importer that reads a date or a number cell
// with one fixed rule, so an ambiguous cell is silently read the wrong way round. "03/04/2024" is
// April 3 under American and March 4 under European, and "1.000,50" is one thousand and a half
// only when the comma is the decimal mark. A mapping that offers the format per property lets the
// person say which one the file is in; a mapping that does not turns European data into wrong
// values with no error.
//
// Every function here is pure and takes the format explicitly, so an importer keeps its own wizard
// and its own copy: only the reading rule is shared. A cell the named format cannot read returns
// null rather than a guessed value, so the caller stores no value instead of a wrong one.

/** The date order one date-typed import property declares. */
export type ImportDateFormat = "iso" | "european" | "american";

/** The decimal mark one number-typed import property declares. */
export type ImportNumberSeparator = "period" | "comma";

// The choices a format control offers, in the order and with the examples the mapping shows, and
// the value each property starts on. A format covers several spellings of the same date, so each
// choice lists them all rather than one example.
export const IMPORT_DATE_FORMAT_OPTIONS: Array<{
  value: ImportDateFormat;
  label: string;
  examples: string[];
}> = [
  { value: "iso", label: "ISO standard", examples: ["2024-05-15"] },
  {
    value: "european",
    label: "European",
    examples: ["15-05-2024", "15/05/2024", "15 May 2024"],
  },
  {
    value: "american",
    label: "American",
    examples: ["05-15-2024", "05/15/2024", "May 15th 2024"],
  },
];

export const DEFAULT_IMPORT_DATE_FORMAT: ImportDateFormat = "iso";

export const IMPORT_NUMBER_SEPARATOR_OPTIONS: Array<{
  value: ImportNumberSeparator;
  label: string;
  example: string;
}> = [
  { value: "period", label: "Point", example: "1,000.00" },
  { value: "comma", label: "Comma", example: "1.000,00" },
];

export const DEFAULT_IMPORT_NUMBER_SEPARATOR: ImportNumberSeparator = "period";

function pad(value: number, width = 2) {
  return String(value).padStart(width, "0");
}

/**
 * A date cell the format says the order of: `2024-05-15`, `15-05-2024` or `05-15-2024` (also
 * `/` and `.` between the parts), returned as a `YYYY-MM-DD` day. A cell whose parts do not make a
 * real day in that order is null, and so is a written month, which the caller's own natural
 * parser owns rather than this format.
 */
export function parseImportDate(
  text: string,
  format: ImportDateFormat,
): string | null {
  const match = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/.exec(text.trim());
  if (!match) return null;
  const first = match.at(1) ?? "";
  const second = match.at(2) ?? "";
  const third = match.at(3) ?? "";
  let year: number;
  let month: number;
  let day: number;
  if (format === "iso") {
    // ISO states the year first, so a short first part is not ISO at all.
    if (first.length !== 4) return null;
    year = Number(first);
    month = Number(second);
    day = Number(third);
  } else if (format === "european") {
    if (third.length !== 4) return null;
    day = Number(first);
    month = Number(second);
    year = Number(third);
  } else {
    if (third.length !== 4) return null;
    month = Number(first);
    day = Number(second);
    year = Number(third);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCFullYear() !== year
  )
    return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * A number cell read the way the separator says to read it: under Point a comma groups thousands
 * and a full stop is the decimal mark (`1,000.50` is one thousand and a half), under Comma the two
 * swap (`1.000,50` is the same number). A cell that is not a number in that format is null rather
 * than a guess, so a text cell in a number column stores no value.
 */
export function parseImportNumber(
  text: string,
  separator: ImportNumberSeparator,
): number | null {
  // Currency symbols, currency codes and spaces carry no part order, so they are dropped first.
  const bare = text.replace(/[^0-9.,+-]/g, "");
  if (!/[0-9]/.test(bare)) return null;
  const normalised =
    separator === "comma"
      ? bare.replace(/\./g, "").replace(/,/g, ".")
      : bare.replace(/,/g, "");
  // A second decimal mark after normalising means the cell is not written in this format.
  if ((normalised.match(/\./g) || []).length > 1) return null;
  if (!/^[+-]?\d*(\.\d+)?$/.test(normalised)) return null;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Print a day in the chosen order, so a mapping can show what it understood. */
export function formatImportDate(date: Date, format: ImportDateFormat): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  if (format === "iso") return `${year}-${month}-${day}`;
  if (format === "european") return `${day}-${month}-${year}`;
  return `${month}-${day}-${year}`;
}

/** Print a number with the chosen separator, so a mapping can show what it understood. */
export function formatImportNumber(
  value: number,
  separator: ImportNumberSeparator,
  fractionDigits = 2,
): string {
  const fixed = value.toFixed(fractionDigits);
  const [whole = "0", fraction = ""] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "_");
  if (separator === "period") {
    const thousands = grouped.replace(/_/g, ",");
    return fraction ? `${thousands}.${fraction}` : thousands;
  }
  const thousands = grouped.replace(/_/g, ".");
  return fraction ? `${thousands},${fraction}` : thousands;
}
