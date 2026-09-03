/**
 * Grid state → server request, and the optimistic cache patch that goes with a
 * cell write. Kept pure: the grid must never narrow a page it already has, and
 * that is only provable if the request builder is testable on its own.
 */

import type { CrmCellValue, CrmGridAttribute } from "./model";

export interface CrmGridSortEntry {
  attributeId?: string;
  field?: string;
  direction: "asc" | "desc";
}

export interface CrmGridFilterLeaf {
  attributeId?: string;
  field?: string;
  condition: string;
  value?: string | number | boolean | null | Array<string | number | boolean>;
}

export interface CrmGridFilter {
  op: "and" | "or";
  conditions: CrmGridFilterLeaf[];
}

export interface CrmGridQueryState {
  kind?: "account" | "person" | "opportunity";
  connectionId?: string;
  viewId?: string;
  /** Display-name search. Sent to the server; never applied to a loaded page. */
  search?: string;
  filter?: CrmGridFilter;
  sort?: CrmGridSortEntry[];
  pageSize?: number;
}

export const CRM_GRID_PAGE_SIZE = 50;

/**
 * Parameters for `list-crm-records`. Every narrowing input is on the wire —
 * the grid has no local filter path to fall back to, by construction.
 */
export function listRecordsParams(
  state: CrmGridQueryState,
  cursor?: string,
): Record<string, unknown> {
  const search = state.search?.trim();
  return {
    ...(state.kind ? { kind: state.kind } : {}),
    ...(state.connectionId ? { connectionId: state.connectionId } : {}),
    ...(state.viewId ? { viewId: state.viewId } : {}),
    ...(search ? { query: search } : {}),
    // A saved view owns its filter; sending both is a 422 at the action.
    ...(state.filter && state.filter.conditions.length && !state.viewId
      ? { filter: state.filter }
      : {}),
    ...(state.sort && state.sort.length ? { sort: state.sort } : {}),
    limit: state.pageSize ?? CRM_GRID_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  };
}

// ---------------------------------------------------------------------------
// Column configuration — the saved view's `columns_json`
// ---------------------------------------------------------------------------

export interface CrmGridColumn {
  attributeId: string;
  width?: number;
  hidden?: boolean;
}

const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 720;

/** Accepts both the legacy `string[]` and the typed `columns_json` shape. */
export function normalizeGridColumns(raw: unknown): CrmGridColumn[] {
  if (!Array.isArray(raw)) return [];
  const columns: CrmGridColumn[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry) {
      columns.push({ attributeId: entry });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const attributeId =
      typeof record.attributeId === "string" ? record.attributeId : null;
    if (!attributeId) continue;
    const width =
      typeof record.width === "number" && Number.isFinite(record.width)
        ? Math.min(Math.max(record.width, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH)
        : undefined;
    columns.push({
      attributeId,
      ...(width === undefined ? {} : { width }),
      ...(record.hidden === true ? { hidden: true } : {}),
    });
  }
  return columns;
}

/**
 * The grid's column order: saved columns first, in their saved order, then any
 * attribute the saved view has never seen. A saved column whose attribute no
 * longer exists is dropped rather than rendered as a blank column.
 */
export function resolveGridColumns(
  saved: CrmGridColumn[],
  attributes: CrmGridAttribute[],
): CrmGridColumn[] {
  const known = new Map(
    attributes.map((attribute) => [attribute.apiSlug, attribute]),
  );
  const seen = new Set<string>();
  const ordered: CrmGridColumn[] = [];
  for (const column of saved) {
    if (!known.has(column.attributeId) || seen.has(column.attributeId))
      continue;
    seen.add(column.attributeId);
    ordered.push(column);
  }
  for (const attribute of attributes) {
    if (seen.has(attribute.apiSlug)) continue;
    ordered.push({ attributeId: attribute.apiSlug });
  }
  return ordered;
}

export function setGridColumnWidth(
  columns: CrmGridColumn[],
  attributeId: string,
  width: number,
): CrmGridColumn[] {
  const clamped = Math.min(
    Math.max(Math.round(width), MIN_COLUMN_WIDTH),
    MAX_COLUMN_WIDTH,
  );
  return columns.map((column) =>
    column.attributeId === attributeId ? { ...column, width: clamped } : column,
  );
}

export function setGridColumnHidden(
  columns: CrmGridColumn[],
  attributeId: string,
  hidden: boolean,
): CrmGridColumn[] {
  return columns.map((column) =>
    column.attributeId === attributeId
      ? hidden
        ? { ...column, hidden: true }
        : {
            attributeId: column.attributeId,
            ...(column.width ? { width: column.width } : {}),
          }
      : column,
  );
}

export function moveGridColumn(
  columns: CrmGridColumn[],
  attributeId: string,
  toIndex: number,
): CrmGridColumn[] {
  const from = columns.findIndex(
    (column) => column.attributeId === attributeId,
  );
  if (from < 0) return columns;
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  if (!moved) return columns;
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
  return next;
}

// ---------------------------------------------------------------------------
// Optimistic cell writes
// ---------------------------------------------------------------------------

export interface CrmRecordValuesEntry {
  recordId: string;
  remoteRevision?: string | null;
  values: Record<string, CrmCellValue>;
  valuesSince?: Record<string, string>;
}

export interface CrmRecordValuesPayload {
  records: CrmRecordValuesEntry[];
}

/**
 * Immutably set one cell in a `list-crm-record-values` payload.
 *
 * Returns the SAME object when no record matched, so a caller can tell "wrote
 * optimistically" from "the row is not in this cache" instead of assuming the
 * patch landed. Rollback is restoring the previous payload.
 */
export function patchRecordValues(
  payload: CrmRecordValuesPayload | undefined,
  recordId: string,
  attributeSlug: string,
  value: CrmCellValue,
): CrmRecordValuesPayload | undefined {
  if (!payload) return payload;
  let matched = false;
  const records = payload.records.map((entry) => {
    if (entry.recordId !== recordId) return entry;
    matched = true;
    return { ...entry, values: { ...entry.values, [attributeSlug]: value } };
  });
  return matched ? { ...payload, records } : payload;
}
