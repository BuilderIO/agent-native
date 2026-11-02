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

function isValidColumn(column: unknown): boolean {
  if (!isRecord(column)) return false;
  if (typeof column.key !== "string" || column.key === "") return false;
  if (
    column.format !== undefined &&
    !(
      typeof column.format === "string" &&
      Object.prototype.hasOwnProperty.call(COLUMN_FORMATS, column.format)
    )
  ) {
    return false;
  }
  if (column.label !== undefined && typeof column.label !== "string") {
    return false;
  }
  if (column.linkKey !== undefined && typeof column.linkKey !== "string") {
    return false;
  }
  if (column.hidden !== undefined && typeof column.hidden !== "boolean") {
    return false;
  }
  return (
    column.width === undefined ||
    (typeof column.width === "number" && Number.isFinite(column.width))
  );
}

export function isValidPanelColumns(value: unknown): boolean {
  return Array.isArray(value) && value.every(isValidColumn);
}

/** Renderer read of `config.columns`: a stored non-array renders as unconfigured instead of throwing. */
export function readPanelColumns<T extends { key: string }>(
  value: T[] | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (column) => isRecord(column) && typeof column.key === "string",
  );
}
