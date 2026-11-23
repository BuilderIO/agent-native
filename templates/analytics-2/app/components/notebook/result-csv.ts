type CsvValue = string | number | boolean | null;

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    return /^(?:[\t\r\n]|\s*[=+\-@])/.test(value) ? `'${value}` : value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, (_key, inner) =>
        typeof inner === "bigint" ? inner.toString() : inner,
      );
    } catch {
      return "";
    }
  }
  return String(value);
}

export function csvFilename(label: string | null | undefined): string {
  const base = (label ?? "")
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .trim();
  const clipped = Array.from(base).slice(0, 100).join("").trim();
  return `${clipped || "results"}.csv`;
}

function csvField(value: unknown, delimiter: string): string {
  const text = cellText(value);
  return text.includes(delimiter) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function resultCsv(
  columns: readonly { name: string }[],
  rows: readonly (readonly CsvValue[])[],
  delimiter = ",",
): string {
  return (
    [
      columns.map((column) => csvField(column.name, delimiter)).join(delimiter),
      ...rows.map((row) =>
        columns
          .map((_, index) => csvField(row[index], delimiter))
          .join(delimiter),
      ),
    ].join("\r\n") + "\r\n"
  );
}

export function resultTsv(
  columns: readonly { name: string }[],
  rows: readonly (readonly CsvValue[])[],
): string {
  return resultCsv(columns, rows, "\t");
}
