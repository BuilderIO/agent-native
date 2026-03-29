/**
 * Multi-tenant data scoping for db-query / db-exec.
 *
 * In production mode, creates temporary views that shadow real tables so
 * that raw SQL only sees the current user's data.
 *
 * Convention:
 *   - Template tables use an `owner_email` column for user scoping.
 *   - Core tables have their own scoping patterns (key prefix, session_id, etc.).
 *
 * Temp views take precedence over real tables in both SQLite and Postgres,
 * so the user's SQL runs unmodified against the filtered views.
 */

// Core tables with non-standard scoping (not owner_email).
// Map of table name → { column, mode }.
const CORE_TABLE_SCOPING: Record<
  string,
  { column: string; mode: "prefix" | "exact" }
> = {
  settings: { column: "key", mode: "prefix" }, // keys like u:<email>:<key>
  application_state: { column: "session_id", mode: "exact" },
  oauth_tokens: { column: "owner", mode: "exact" },
  sessions: { column: "email", mode: "exact" },
};

// The conventional column name for user ownership in template tables.
const OWNER_COLUMN = "owner_email";

interface ScopedTable {
  name: string;
  viewSql: string;
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

function getUserEmail(): string | null {
  return process.env.AGENT_USER_EMAIL || null;
}

// ─── Schema introspection ───────────────────────────────────────────────────

interface TableColumn {
  table: string;
  column: string;
}

async function discoverColumnsPostgres(pgSql: any): Promise<TableColumn[]> {
  const rows: any[] = await pgSql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;
  return rows.map((r) => ({ table: r.table_name, column: r.column_name }));
}

async function discoverColumnsSqlite(client: any): Promise<TableColumn[]> {
  const tablesResult = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
  );
  const tables = tablesResult.rows.map((r: any) => (r.name ?? r[0]) as string);

  const result: TableColumn[] = [];
  for (const table of tables) {
    const escaped = table.replace(/"/g, '""');
    const colsResult = await client.execute(`PRAGMA table_info("${escaped}")`);
    for (const row of colsResult.rows) {
      result.push({
        table,
        column: (row.name ?? row[1]) as string,
      });
    }
  }
  return result;
}

// ─── View generation ────────────────────────────────────────────────────────

/** Escape a string for safe inclusion in a SQL single-quoted literal. */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function buildScopedTables(
  allColumns: TableColumn[],
  userEmail: string,
  isPostgres: boolean,
): ScopedTable[] {
  // Group columns by table
  const columnsByTable = new Map<string, string[]>();
  for (const { table, column } of allColumns) {
    const cols = columnsByTable.get(table) || [];
    cols.push(column);
    columnsByTable.set(table, cols);
  }

  const scoped: ScopedTable[] = [];
  const qualifiedPrefix = isPostgres ? "public." : "main.";
  const safeEmail = escapeSqlString(userEmail);

  for (const [table, columns] of columnsByTable) {
    // Check core table scoping
    const coreScoping = CORE_TABLE_SCOPING[table];
    if (coreScoping) {
      const realTable = `${qualifiedPrefix}"${table}"`;
      let whereSql: string;
      if (coreScoping.mode === "prefix") {
        // settings: key starts with u:<email>:
        // Escape \, % and _ in the email so LIKE treats them literally.
        const likeEmail = safeEmail
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        const prefix = `u:${likeEmail}:`;
        whereSql = `"${coreScoping.column}" LIKE '${prefix}%' ESCAPE '\\'`;
      } else {
        whereSql = `"${coreScoping.column}" = '${safeEmail}'`;
      }
      scoped.push({
        name: table,
        viewSql: `CREATE TEMPORARY VIEW "${table}" AS SELECT * FROM ${realTable} WHERE ${whereSql}`,
      });
      continue;
    }

    // Check for owner_email convention column
    if (columns.includes(OWNER_COLUMN)) {
      const realTable = `${qualifiedPrefix}"${table}"`;
      scoped.push({
        name: table,
        viewSql: `CREATE TEMPORARY VIEW "${table}" AS SELECT * FROM ${realTable} WHERE "${OWNER_COLUMN}" = '${safeEmail}'`,
      });
    }
  }

  return scoped;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ScopingContext {
  /** SQL statements to run before the user's query (create temp views). */
  setup: string[];
  /** SQL statements to run after the user's query (drop temp views). */
  teardown: string[];
  /** Whether scoping is active. */
  active: boolean;
  /** The current user email (for INSERT injection in db-exec). */
  userEmail: string | null;
  /** Tables that have owner_email columns (for INSERT injection). */
  ownerEmailTables: Set<string>;
}

/**
 * Build scoping context for a Postgres connection.
 * Returns setup/teardown SQL to run before/after the user's query.
 */
export async function buildScopingPostgres(
  pgSql: any,
): Promise<ScopingContext> {
  if (!isProd()) {
    return {
      setup: [],
      teardown: [],
      active: false,
      userEmail: null,
      ownerEmailTables: new Set(),
    };
  }

  const userEmail = getUserEmail();
  if (!userEmail) {
    return {
      setup: [],
      teardown: [],
      active: false,
      userEmail: null,
      ownerEmailTables: new Set(),
    };
  }

  const allColumns = await discoverColumnsPostgres(pgSql);
  const scoped = buildScopedTables(allColumns, userEmail, true);

  // Track which tables have owner_email for INSERT injection
  const columnsByTable = new Map<string, string[]>();
  for (const { table, column } of allColumns) {
    const cols = columnsByTable.get(table) || [];
    cols.push(column);
    columnsByTable.set(table, cols);
  }
  const ownerEmailTables = new Set<string>();
  for (const [table, columns] of columnsByTable) {
    if (columns.includes(OWNER_COLUMN)) ownerEmailTables.add(table);
  }

  return {
    setup: scoped.map((s) => s.viewSql),
    teardown: scoped.map((s) => `DROP VIEW IF EXISTS "${s.name}"`),
    active: scoped.length > 0,
    userEmail,
    ownerEmailTables,
  };
}

/**
 * Build scoping context for a SQLite/libsql connection.
 * Returns setup/teardown SQL to run before/after the user's query.
 */
export async function buildScopingSqlite(client: any): Promise<ScopingContext> {
  if (!isProd()) {
    return {
      setup: [],
      teardown: [],
      active: false,
      userEmail: null,
      ownerEmailTables: new Set(),
    };
  }

  const userEmail = getUserEmail();
  if (!userEmail) {
    return {
      setup: [],
      teardown: [],
      active: false,
      userEmail: null,
      ownerEmailTables: new Set(),
    };
  }

  const allColumns = await discoverColumnsSqlite(client);
  const scoped = buildScopedTables(allColumns, userEmail, false);

  const columnsByTable = new Map<string, string[]>();
  for (const { table, column } of allColumns) {
    const cols = columnsByTable.get(table) || [];
    cols.push(column);
    columnsByTable.set(table, cols);
  }
  const ownerEmailTables = new Set<string>();
  for (const [table, columns] of columnsByTable) {
    if (columns.includes(OWNER_COLUMN)) ownerEmailTables.add(table);
  }

  return {
    setup: scoped.map((s) => s.viewSql),
    teardown: scoped.map((s) => `DROP VIEW IF EXISTS "${s.name}"`),
    active: scoped.length > 0,
    userEmail,
    ownerEmailTables,
  };
}
