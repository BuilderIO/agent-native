/**
 * Shared contract types for the dev-mode database admin (Supabase-Studio-like).
 *
 * The backend (operations / routes / agent tools) and the frontend both import
 * these so request/response shapes stay in lockstep. Keep this file free of any
 * runtime imports — it is a pure type module.
 */

export type DbAdminDialect = "sqlite" | "postgres" | "d1";

export interface DbAdminColumn {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  defaultValue: string | null;
  autoIncrement?: boolean;
  largeValuePreview?: boolean;
}

export interface DbAdminForeignKey {
  column: string;
  refTable: string;
  refColumn: string;
}

export interface DbAdminIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface DbAdminTableSummary {
  name: string;
  type: "table" | "view";
  rowCount: number | null;
}

export interface DbAdminTableSchema {
  name: string;
  type: "table" | "view";
  columns: DbAdminColumn[];
  primaryKey: string[];
  foreignKeys: DbAdminForeignKey[];
  indexes: DbAdminIndex[];
  rowCount: number | null;
}

export type DbAdminFilterOp =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "like"
  | "ilike"
  | "in"
  | "is_null"
  | "not_null";

export interface DbAdminFilter {
  column: string;
  op: DbAdminFilterOp;
  value?: unknown;
}

export interface DbAdminSort {
  column: string;
  dir: "asc" | "desc";
}

export interface DbAdminRowsRequest {
  page: number;
  pageSize: number;
  sort?: DbAdminSort[];
  filters?: DbAdminFilter[];
  includeLargeCells?: boolean;
}

export interface DbAdminRowsResult {
  columns: DbAdminColumn[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  truncatedCells?: number;
}

export interface DbAdminMutation {
  inserts?: Record<string, unknown>[];
  updates?: { where: Record<string, unknown>; set: Record<string, unknown> }[];
  deletes?: Record<string, unknown>[];
  dryRun?: boolean;
}

export interface DbAdminMutationResult {
  sql: string[];
  inserted: number;
  updated: number;
  deleted: number;
}

export interface DbAdminQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number;
  durationMs: number;
  truncatedCells?: number;
}
