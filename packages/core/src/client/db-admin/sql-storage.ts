
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


export function loadHistory(): string[] {
  const list = readJSON<string[]>(HISTORY_KEY, []);
  return Array.isArray(list) ? list.filter((s) => typeof s === "string") : [];
}

export function pushHistory(sql: string): string[] {
  const trimmed = sql.trim();
  if (!trimmed) return loadHistory();

  const existing = loadHistory();
  if (existing[0] === trimmed) return existing;

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
