import type { DocumentProperty } from "./api.js";
import { formulaValueText, type DocumentPropertyValue } from "./properties.js";

export interface DatabaseCsvColumn {
  id: string;
  name: string;
  property: {
    definition: Pick<DocumentProperty["definition"], "type" | "options">;
  };
}

function propertyValueText(
  property: DatabaseCsvColumn["property"],
  value: DocumentPropertyValue | undefined,
): string {
  if (value == null) return "";
  const optionName = (entry: string) =>
    property.definition.options.options?.find((option) => option.id === entry)
      ?.name ?? entry;
  if (Array.isArray(value)) return value.map(optionName).join(", ");
  if (
    property.definition.type === "select" ||
    property.definition.type === "status"
  ) {
    return optionName(String(value));
  }
  if (property.definition.type === "checkbox") {
    return value ? "TRUE" : "FALSE";
  }
  return formulaValueText(value);
}

export interface DatabaseCsvRow {
  title: string | null | undefined;
  values: ReadonlyMap<string, DocumentPropertyValue>;
}

function csvCell(value: string): string {
  const safe = /^[\t ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Render an already-authorized, ordered database projection as RFC 4180 CSV. */
export function renderDatabaseCsv(
  columns: readonly DatabaseCsvColumn[],
  rows: readonly DatabaseCsvRow[],
): string {
  const header = ["Title", ...columns.map((column) => column.name)];
  const data = rows.map((row) => [
    row.title ?? "",
    ...columns.map((column) => {
      return propertyValueText(column.property, row.values.get(column.id));
    }),
  ]);
  return [...[header], ...data]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}
