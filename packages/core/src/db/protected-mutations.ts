const PROTECTED_TABLES_KEY = Symbol.for(
  "@agent-native/core/db.protected-mutation-tables",
);

interface ProtectedMutationTable {
  guidance: string;
}

type GlobalWithProtectedTables = typeof globalThis & {
  [PROTECTED_TABLES_KEY]?: Map<string, ProtectedMutationTable>;
};

function protectedTables(): Map<string, ProtectedMutationTable> {
  const globalRef = globalThis as GlobalWithProtectedTables;
  if (!globalRef[PROTECTED_TABLES_KEY]) {
    globalRef[PROTECTED_TABLES_KEY] = new Map();
  }
  return globalRef[PROTECTED_TABLES_KEY]!;
}

function normalizeTableName(table: string): string {
  return table
    .trim()
    .replace(/^["'`[]/, "")
    .replace(/["'`\]]$/, "")
    .split(".")
    .at(-1)!
    .toLowerCase();
}

export interface ProtectedMutationTablesRegistration {
  tables: readonly string[];
  guidance: string;
}

export function registerProtectedMutationTables(
  registration: ProtectedMutationTablesRegistration,
): () => void {
  const names = registration.tables.map(normalizeTableName);
  for (const name of names) {
    protectedTables().set(name, { guidance: registration.guidance });
  }
  return () => {
    for (const name of names) protectedTables().delete(name);
  };
}

export function assertMutationTableIsNotProtected(table: string): void {
  const normalized = normalizeTableName(table);
  const registration = protectedTables().get(normalized);
  if (!registration) return;
  throw new Error(
    `Table "${normalized}" is protected from raw database mutations because its domain action records durable change events. ${registration.guidance}`,
  );
}

export function protectedMutationTableFromSql(sql: string): string | null {
  let cleanSql = "";
  let state: "normal" | "single" | "line-comment" | "block-comment" = "normal";
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1];
    if (state === "line-comment") {
      if (char === "\n") {
        cleanSql += " ";
        state = "normal";
      }
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        index++;
        cleanSql += " ";
        state = "normal";
      }
      continue;
    }
    if (state === "single") {
      if (char === "'" && next === "'") index++;
      else if (char === "'") {
        cleanSql += " ";
        state = "normal";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      index++;
      state = "line-comment";
      continue;
    }
    if (char === "/" && next === "*") {
      index++;
      state = "block-comment";
      continue;
    }
    if (char === "'") {
      state = "single";
      continue;
    }
    cleanSql += char;
  }

  const tablePattern =
    /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+((?:"[^"]+"|`[^`]+`|[\w]+)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|[\w]+))?)/gi;
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(cleanSql)) !== null) {
    const normalized = normalizeTableName(match[1]);
    if (protectedTables().has(normalized)) return normalized;
  }
  return null;
}

export function assertSqlDoesNotMutateProtectedTable(sql: string): void {
  const table = protectedMutationTableFromSql(sql);
  if (table) assertMutationTableIsNotProtected(table);
}

export function __resetProtectedMutationTables(): void {
  protectedTables().clear();
}
