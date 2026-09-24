/**
 * Client-side persistence for the SQL editor surface of the dev-mode database
 * admin. Everything lives in `localStorage` under the `agentnative.dbadmin.sql.*`
 * namespace and is SSR-safe (no-ops when `window` is unavailable).
 *
 * Two stores live here:
 *  - Query HISTORY: a capped, de-duplicated list of executed SQL strings, most
 *    recent first. Useful for re-loading a previous query into the editor.
 *  - Saved SNIPPETS: named, reusable queries the user explicitly saved.
 */

const HISTORY_KEY = "agentnative.dbadmin.sql.history";
const SNIPPETS_KEY = "agentnative.dbadmin.sql.snippets";
const HISTORY_CAP = 50;

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readJSON<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / privacy mode — silently degrade.
  }
}

// ─── History ───────────────────────────────────────────────────────────────

export function loadHistory(): string[] {
  const list = readJSON<string[]>(HISTORY_KEY, []);
  return Array.isArray(list) ? list.filter((s) => typeof s === "string") : [];
}

/**
 * Prepend an executed query to the history. Trims whitespace, skips empties,
 * de-dupes against the most-recent entry, and caps the list length. Returns the
 * updated list so callers can update their in-memory copy without re-reading.
 */
export function pushHistory(sql: string): string[] {
  const trimmed = sql.trim();
  if (!trimmed) return loadHistory();

  const existing = loadHistory();
  if (existing[0] === trimmed) return existing;

  // Remove any earlier identical entry so the list stays unique while keeping
  // the newly executed query at the top.
  const deduped = existing.filter((s) => s !== trimmed);
  const next = [trimmed, ...deduped].slice(0, HISTORY_CAP);
  writeJSON(HISTORY_KEY, next);
  return next;
}

export function clearHistory(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

// ─── Snippets ────────────────────────────────────────────────────────────────

export interface SqlSnippet {
  id: string;
  name: string;
  sql: string;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `snip-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function loadSnippets(): SqlSnippet[] {
  const list = readJSON<SqlSnippet[]>(SNIPPETS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter(
    (s): s is SqlSnippet =>
      !!s &&
      typeof s.id === "string" &&
      typeof s.name === "string" &&
      typeof s.sql === "string",
  );
}

/**
 * Create or update a snippet. Pass an `id` to update an existing one; omit it to
 * create a new snippet. Returns the updated list.
 */
export function saveSnippet(input: {
  id?: string;
  name: string;
  sql: string;
}): SqlSnippet[] {
  const name = input.name.trim();
  const sql = input.sql.trim();
  if (!name || !sql) return loadSnippets();

  const existing = loadSnippets();
  let next: SqlSnippet[];
  if (input.id && existing.some((s) => s.id === input.id)) {
    next = existing.map((s) => (s.id === input.id ? { ...s, name, sql } : s));
  } else {
    next = [{ id: input.id ?? newId(), name, sql }, ...existing];
  }
  writeJSON(SNIPPETS_KEY, next);
  return next;
}

export function deleteSnippet(id: string): SqlSnippet[] {
  const next = loadSnippets().filter((s) => s.id !== id);
  writeJSON(SNIPPETS_KEY, next);
  return next;
}
