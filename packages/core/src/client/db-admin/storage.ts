/**
 * Typed, SSR-safe localStorage helpers for the database admin UI.
 *
 * All keys live under the `agentnative.dbadmin.*` namespace. Per-table grid
 * state (column widths, sort, filters, page size) is persisted so reopening a
 * table restores the user's last view.
 */
import type { DbAdminFilter, DbAdminSort } from "../../db-admin/types.js";

const NS = "agentnative.dbadmin.";

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Read and JSON-parse a namespaced key, returning `fallback` on any failure. */
export function getLS<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(`${NS}${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** JSON-serialize and write a namespaced key. No-op when storage is absent. */
export function setLS<T>(key: string, value: T): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(`${NS}${key}`, JSON.stringify(value));
  } catch {
    // Quota exceeded / disabled storage — silently ignore.
  }
}

/** Remove a namespaced key. */
export function removeLS(key: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(`${NS}${key}`);
  } catch {
    // ignore
  }
}

// ─── Per-table grid state ──────────────────────────────────────────────────

export interface GridState {
  /** Column name → pixel width. */
  columnWidths?: Record<string, number>;
  sort?: DbAdminSort[];
  filters?: DbAdminFilter[];
  pageSize?: number;
}

function gridKey(table: string): string {
  return `grid.${table}`;
}

export function loadGridState(table: string): GridState {
  return getLS<GridState>(gridKey(table), {});
}

export function saveGridState(table: string, state: GridState): void {
  setLS<GridState>(gridKey(table), state);
}
