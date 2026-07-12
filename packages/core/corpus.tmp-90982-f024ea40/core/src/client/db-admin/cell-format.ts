import type { DbAdminColumn } from "../../db-admin/types.js";

/**
 * Type-aware cell formatting and parsing helpers for the DB admin grid.
 *
 * These are intentionally dialect-agnostic: they look at the column's `type`
 * string and normalize it into one of a small set of editor "kinds" that drive
 * which editor UI is rendered and how values are parsed back into the mutation
 * payload.
 */

export type EditorKind =
  | "text"
  | "number"
  | "boolean"
  | "json"
  | "timestamp"
  | "enum"
  | "uuid";

/** Sentinel meaning "store SQL NULL". */
export const NULL_VALUE = null;

const NUMBER_TYPES = [
  "int",
  "integer",
  "smallint",
  "bigint",
  "serial",
  "bigserial",
  "smallserial",
  "decimal",
  "numeric",
  "real",
  "double",
  "float",
  "money",
];

const BOOLEAN_TYPES = ["bool", "boolean"];
const JSON_TYPES = ["json", "jsonb"];
const TIMESTAMP_TYPES = [
  "timestamp",
  "timestamptz",
  "datetime",
  "date",
  "time",
  "timetz",
];
const UUID_TYPES = ["uuid", "guid"];

function normalizeType(col: DbAdminColumn): string {
  return (col.type || "").toString().trim().toLowerCase();
}

/**
 * Try to pull allowed enum values out of a column definition.
 *
 * The base contract column shape (`DbAdminColumn`) only carries a `type`
 * string, but introspection may attach extra fields per dialect. We probe a
 * few likely shapes and also parse a Postgres/MySQL-style inline list embedded
 * in the type string, e.g. `enum('a','b')`.
 */
export function inferEnumValues(col: DbAdminColumn): string[] | null {
  const anyCol = col as unknown as Record<string, unknown>;
  const candidates = [anyCol.enumValues, anyCol.values, anyCol.options];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate.map((v) => String(v));
    }
  }
  const type = (col.type || "").toString();
  const match = type.match(/^\s*(?:enum|set)\s*\((.+)\)\s*$/i);
  if (match) {
    const items = match[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter((s) => s.length > 0);
    if (items.length > 0) return items;
  }
  return null;
}

/** Infer which editor UI a column should use. */
export function inferEditorKind(col: DbAdminColumn): EditorKind {
  const type = normalizeType(col);

  if (inferEnumValues(col)) return "enum";
  if (UUID_TYPES.some((t) => type.includes(t))) return "uuid";
  if (BOOLEAN_TYPES.some((t) => type === t || type.includes(t)))
    return "boolean";
  if (JSON_TYPES.some((t) => type === t || type.includes(t))) return "json";
  if (TIMESTAMP_TYPES.some((t) => type.includes(t))) return "timestamp";
  if (NUMBER_TYPES.some((t) => type.includes(t))) return "number";
  return "text";
}

/** Whether a value is SQL NULL (vs empty string, 0, false, etc). */
export function isNull(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Format a DB value for compact in-cell display. Returns a marker the cell uses
 * to render NULL distinctly; for plain string consumers the text is "NULL".
 */
export function formatCellValue(
  value: unknown,
  kind: EditorKind,
): { text: string; isNull: boolean } {
  if (isNull(value)) return { text: "NULL", isNull: true };

  switch (kind) {
    case "boolean":
      return { text: value === true ? "true" : "false", isNull: false };
    case "json":
      return { text: formatJsonCompact(value), isNull: false };
    case "timestamp":
      return { text: formatTimestamp(value), isNull: false };
    case "number":
      return { text: String(value), isNull: false };
    default:
      return { text: String(value), isNull: false };
  }
}

/** Compact single-line JSON for cell display. */
export function formatJsonCompact(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Pretty multi-line JSON for the expanded editor. */
export function formatJsonPretty(value: unknown): string {
  if (isNull(value)) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Human-readable timestamp; tolerant of strings, numbers, and Dates. */
export function formatTimestamp(value: unknown): string {
  if (isNull(value)) return "";
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Convert a DB value to the string an editor input should start with. */
export function valueToEditString(value: unknown, kind: EditorKind): string {
  if (isNull(value)) return "";
  if (kind === "json") return formatJsonPretty(value);
  if (kind === "timestamp") return formatTimestamp(value);
  if (kind === "boolean") return value === true ? "true" : "false";
  return String(value);
}

export class ParseError extends Error {}

/**
 * Parse an edited string back into the JS value sent in the mutation payload.
 *
 * `allowEmptyString` distinguishes "" → empty string from "" → NULL. For most
 * types empty means NULL; for text the editor decides.
 */
export function parseEditValue(
  raw: string,
  kind: EditorKind,
  opts: { allowEmptyString?: boolean } = {},
): unknown {
  if (raw === "") {
    if (kind === "text" && opts.allowEmptyString) return "";
    return NULL_VALUE;
  }

  const trimmed = raw.trim();

  switch (kind) {
    case "number": {
      const n = Number(trimmed);
      if (trimmed === "" || Number.isNaN(n)) {
        throw new ParseError(`"${raw}" is not a valid number`);
      }
      return n;
    }
    case "boolean": {
      const v = trimmed.toLowerCase();
      if (["true", "t", "1", "yes", "y"].includes(v)) return true;
      if (["false", "f", "0", "no", "n"].includes(v)) return false;
      if (v === "null") return NULL_VALUE;
      throw new ParseError(`"${raw}" is not a valid boolean`);
    }
    case "json": {
      // Accept ANY valid JSON value, including scalars.
      try {
        return JSON.parse(trimmed);
      } catch (err) {
        throw new ParseError(
          `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    case "timestamp":
    case "uuid":
    case "enum":
    case "text":
    default:
      // Preserve intentional spaces for text; trim structured types.
      return kind === "text" ? raw : trimmed;
  }
}

/** Cycle a tri-state boolean: null → true → false → null. */
export function cycleTriStateBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return true;
  if (value === true) return false;
  return null;
}
