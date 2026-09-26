
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
  search?: string;
  filter?: CrmGridFilter;
  sort?: CrmGridSortEntry[];
  pageSize?: number;
}

export const CRM_GRID_PAGE_SIZE = 50;

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
    ...(state.filter && state.filter.conditions.length && !state.viewId
      ? { filter: state.filter }
      : {}),
    ...(state.sort && state.sort.length ? { sort: state.sort } : {}),
    limit: state.pageSize ?? CRM_GRID_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  };
}


export interface CrmGridColumn {
  attributeId: string;
  width?: number;
  hidden?: boolean;
}

const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 720;

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


export interface CrmRecordValuesEntry {
  recordId: string;
  remoteRevision?: string | null;
  values: Record<string, CrmCellValue>;
  valuesSince?: Record<string, string>;
}

export interface CrmRecordValuesPayload {
  records: CrmRecordValuesEntry[];
}

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
