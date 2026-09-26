import type { DbAdminFilter, DbAdminSort } from "../../db-admin/types.js";

const NS = "agentnative.dbadmin.";

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

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

export function setLS<T>(key: string, value: T): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(`${NS}${key}`, JSON.stringify(value));
  } catch {
    // Quota exceeded / disabled storage — silently ignore.
  }
}

export function removeLS(key: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(`${NS}${key}`);
  } catch {
    // ignore
  }
}

export interface GridState {
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
