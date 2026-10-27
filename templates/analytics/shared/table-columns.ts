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

// A number, maybe with a currency sign before it or a short unit after it:
// "4.8 days", "12%", "$1,200", "3 min".
const NUMBER_WITH_UNIT =
  /^[-+]?[$€£¥]?\d[\d,]*(\.\d+)?\s?(%|[a-zA-Z]{1,8}\.?)?$/;

// Enough rows to judge a column without walking a huge result.
const SAMPLE_ROWS = 200;

export function isNumericColumnFormat(format: ColumnFormat | undefined) {
  return format !== undefined && NUMBER_COLUMN_FORMATS.has(format);
}

/**
 * Columns a table right-aligns in tabular figures: number formats, plus
 * unformatted or text columns whose every value is a number or a number with
 * a short unit.
 */
export function numberTableColumns(
  columns: TableColumnConfig[],
  rows: Record<string, unknown>[],
): Set<string> {
  const sample = rows.slice(0, SAMPLE_ROWS);
  return new Set(
    columns
      .filter((col) => {
        if (isNumericColumnFormat(col.format)) return true;
        if (col.format && col.format !== "text") return false;
        const values = sample
          .map((row) => row[col.key])
          .filter((value) => value != null && value !== "");
        return (
          values.length > 0 &&
          values.every(
            (value) =>
              (typeof value === "number" && Number.isFinite(value)) ||
              (typeof value === "string" &&
                NUMBER_WITH_UNIT.test(value.trim())),
          )
        );
      })
      .map((col) => col.key),
  );
}
