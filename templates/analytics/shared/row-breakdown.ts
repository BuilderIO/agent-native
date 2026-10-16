/**
 * Row breakdowns: clicking a table row opens that row's numbers split by
 * another column, such as app. The panel SQL declares the split with a
 * `{{?breakdown}}…{{/breakdown}}` block; a normal load drops the block, so the
 * panel's own query and cost are unchanged until someone opens a breakdown.
 */

/** The SQL variable a breakdown sets to the column being split by. */
export const BREAKDOWN_SQL_VARIABLE = "breakdown";

/**
 * Bytes one breakdown query may bill. It matches the panel verifier's
 * execution budget, so a breakdown can never scan more than a panel that
 * passed verification could.
 */
export const ROW_BREAKDOWN_MAX_BYTES_BILLED = 50 * 1024 ** 3;

/** Groups smaller than this are drawn muted: too few people to read a rate. */
export const BREAKDOWN_SMALL_GROUP = 20;

/** Groups smaller than this fold into one "Other" row. */
export const BREAKDOWN_FOLD_BELOW = 5;

export const BREAKDOWN_OVER_BYTE_CAP_ERROR = "breakdown_over_byte_cap";

export interface PanelBreakdown {
  /** The result column the breakdown splits by, e.g. `app`. */
  column: string;
  label?: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidPanelBreakdown(value: unknown): value is PanelBreakdown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.column === "string" &&
    IDENTIFIER.test(record.column) &&
    (record.label === undefined || typeof record.label === "string") &&
    Object.keys(record).every((key) => key === "column" || key === "label")
  );
}

export function isValidPanelBreakdowns(
  value: unknown,
): value is PanelBreakdown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isValidPanelBreakdown) &&
    new Set(value.map((item) => item.column)).size === value.length
  );
}

export function sqlHasBreakdownBlock(sql: string): boolean {
  return sql.includes(`{{?${BREAKDOWN_SQL_VARIABLE}}}`);
}

/**
 * Where a breakdown's rows come from: the panel's own rows when they already
 * carry the column (no query), the panel SQL with its breakdown block turned
 * on, or nowhere, which the panel shows as a setup problem.
 */
export type BreakdownPlan =
  | { kind: "reuse" }
  | { kind: "query"; vars: Record<string, string> }
  | { kind: "unavailable" };

export function planBreakdown(args: {
  column: string;
  panelRows: readonly Record<string, unknown>[];
  panelSql: string;
  vars: Record<string, string>;
}): BreakdownPlan {
  const first = args.panelRows[0];
  if (first && Object.prototype.hasOwnProperty.call(first, args.column)) {
    return { kind: "reuse" };
  }
  if (!IDENTIFIER.test(args.column) || !sqlHasBreakdownBlock(args.panelSql)) {
    return { kind: "unavailable" };
  }
  return {
    kind: "query",
    vars: { ...args.vars, [BREAKDOWN_SQL_VARIABLE]: args.column },
  };
}

export function sameCell(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  return String(a) === String(b);
}

const NUMERIC_FORMATS = new Set(["number", "currency", "percent", "delta"]);

function isMeasure(
  format: string | undefined,
  key: string,
  rows: readonly Record<string, unknown>[],
): boolean {
  if (format) return NUMERIC_FORMATS.has(format);
  return rows.some((row) => numberOrNull(row[key]) !== null);
}

/**
 * The columns that name a row, and so match it to its breakdown rows: every
 * non-numeric column but the one being broken down by. Matching on all of
 * them, not just the first, keeps a table with repeated values (two rows for
 * Engineer, one per team) from mixing their splits. An unformatted column is
 * judged by every panel row, so a measure that is blank in the clicked row
 * still counts as one.
 */
export function breakdownRowDimensions(
  columns: readonly { key: string; format?: string }[] | undefined,
  row: Record<string, unknown> | undefined,
  breakdownColumn: string,
  panelRows: readonly Record<string, unknown>[] = [],
): string[] {
  if (!row) return [];
  const sample = [row, ...panelRows];
  const formats = new Map(
    (columns ?? []).map((column) => [column.key, column.format]),
  );
  return Object.keys(row).filter(
    (key) =>
      key !== breakdownColumn && !isMeasure(formats.get(key), key, sample),
  );
}

/** The rows of a breakdown result that belong to the clicked row. */
export function rowsForBreakdown(
  rows: readonly Record<string, unknown>[],
  dimensions: readonly string[],
  row: Record<string, unknown>,
): Record<string, unknown>[] {
  return rows.filter((candidate) =>
    dimensions.every((key) => sameCell(candidate[key], row[key])),
  );
}

export interface BreakdownGroup {
  value: unknown;
  row: Record<string, unknown>;
  size: number | null;
  small: boolean;
}

export interface BreakdownTable {
  groups: BreakdownGroup[];
  /**
   * People in the clicked row that no listed group shows: folded small
   * groups plus any the panel SQL filtered out. Null when there is no size
   * column to count with, or when nothing is left over.
   */
  other: { size: number; groupCount: number } | null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Orders groups by size, folds the tiny ones, and accounts for the rest of
 * the clicked row so the listed groups never silently add up to less than it.
 */
export function buildBreakdownTable(args: {
  rows: readonly Record<string, unknown>[];
  column: string;
  sizeKey: string | null;
  parentSize: unknown;
}): BreakdownTable {
  const { column, sizeKey } = args;
  const groups: BreakdownGroup[] = args.rows.map((row) => {
    const size = sizeKey ? numberOrNull(row[sizeKey]) : null;
    return {
      value: row[column],
      row,
      size,
      small: size !== null && size < BREAKDOWN_SMALL_GROUP,
    };
  });
  if (!sizeKey) return { groups, other: null };

  groups.sort((a, b) => (b.size ?? -1) - (a.size ?? -1));
  const shown = groups.filter(
    (group) => group.size === null || group.size >= BREAKDOWN_FOLD_BELOW,
  );
  const folded = groups.length - shown.length;
  const shownSize = shown.reduce((sum, group) => sum + (group.size ?? 0), 0);
  const parentSize = numberOrNull(args.parentSize);
  const foldedSize = groups
    .filter((group) => !shown.includes(group))
    .reduce((sum, group) => sum + (group.size ?? 0), 0);
  const otherSize =
    parentSize !== null ? Math.max(0, parentSize - shownSize) : foldedSize;
  return {
    groups: shown,
    other: otherSize > 0 ? { size: otherSize, groupCount: folded } : null,
  };
}
