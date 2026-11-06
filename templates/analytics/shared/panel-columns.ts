import type { ColumnFormat } from "../app/pages/adhoc/sql-dashboard/types";

const COLUMN_FORMATS = {
  number: true,
  currency: true,
  percent: true,
  date: true,
  link: true,
  text: true,
  delta: true,
  duration: true,
} satisfies Record<ColumnFormat, true>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const OPTIONAL_COLUMN_FIELDS: Record<string, (value: unknown) => boolean> = {
  format: (value) =>
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(COLUMN_FORMATS, value),
  label: (value) => typeof value === "string",
  linkKey: (value) => typeof value === "string",
  hidden: (value) => typeof value === "boolean",
  width: (value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0,
};

function isKeyedColumn(
  column: unknown,
): column is Record<string, unknown> & { key: string } {
  return (
    isRecord(column) && typeof column.key === "string" && column.key !== ""
  );
}

function isValidColumn(column: unknown): boolean {
  return (
    isKeyedColumn(column) &&
    Object.entries(column).every(
      ([field, value]) =>
        field === "key" ||
        (Object.prototype.hasOwnProperty.call(OPTIONAL_COLUMN_FIELDS, field) &&
          (value === undefined || OPTIONAL_COLUMN_FIELDS[field](value))),
    )
  );
}

export function isValidPanelColumns(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every(isValidColumn)) return false;
  const keys = value.map((column) => (column as { key: string }).key);
  return new Set(keys).size === keys.length;
}

/** Renderer read of `config.columns`: a stored non-array renders as unconfigured instead of throwing. */
export function readPanelColumns<T extends { key: string }>(
  value: T[] | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const columns: T[] = [];
  const seen = new Set<string>();
  for (const column of value) {
    if (!isKeyedColumn(column) || seen.has(column.key)) continue;
    seen.add(column.key);
    const normalized: Record<string, unknown> & { key: string } = {
      key: column.key,
    };
    for (const [field, valid] of Object.entries(OPTIONAL_COLUMN_FIELDS)) {
      if (column[field] !== undefined && valid(column[field])) {
        normalized[field] = column[field];
      }
    }
    columns.push(normalized as T);
  }
  return columns;
}
