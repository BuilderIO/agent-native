/**
 * Per-user and per-org data scoping for db-query / db-exec.
 *
 * In production mode, creates temporary views that shadow real tables so
 * that raw SQL only sees the current user's (and org's) data.
 *
 * Convention:
 *   - Template tables use an `owner_email` column for user scoping.
 *   - Template tables use an `org_id` column for org scoping.
 *   - Core tables have their own scoping patterns (key prefix, session_id, etc.).
 *   - When both columns are present, both WHERE clauses are applied (AND).
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

// The conventional column names for user/org ownership in template tables.
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../../server/request-context.js";

const OWNER_COLUMN = "owner_email";
const ORG_COLUMN = "org_id";
const DEV_FALLBACK_EMAIL = "local@localhost"; // guard:allow-localhost-fallback — sentinel is rejected below so DB scripts cannot silently scope to the dev fallback tenant

interface ScopedTable {
  name: string;
  viewSql: string;
}

function getUserEmail(): string | null {
  const userEmail = getRequestUserEmail() || null;
  if (userEmail === DEV_FALLBACK_EMAIL) {
    throw new Error(
      "DB script scoping requires a real user identity; refusing to run with local@localhost.",
    );
  }
  return userEmail;
}

function getOrgId(): string | null {
  return getRequestOrgId() || null;
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
  orgId: string | null,
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
  const safeOrgId = orgId ? escapeSqlString(orgId) : null;

  // WITH CHECK OPTION ensures INSERTs/UPDATEs through the auto-updatable view
  // can't write rows that violate the WHERE filter. Without it, an attacker
  // could `INSERT INTO recordings (..., owner_email) VALUES (..., 'victim@x')`
  // through the view and the row would land in the base table under the
  // victim's identity. SQLite views are not auto-updatable in the same way
  // (they require triggers), so this clause is a no-op there but harmless.
  const checkOption = isPostgres ? " WITH LOCAL CHECK OPTION" : "";

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
        viewSql: `${isPostgres ? "CREATE OR REPLACE TEMPORARY" : "CREATE TEMPORARY"} VIEW "${table}" AS SELECT * FROM ${realTable} WHERE ${whereSql}${checkOption}`,
      });
      continue;
    }

    if (
      table === "tool_data" &&
      columns.includes("scope") &&
      columns.includes(OWNER_COLUMN) &&
      columns.includes(ORG_COLUMN)
    ) {
      const realTable = `${qualifiedPrefix}"${table}"`;
      const orgClause = safeOrgId
        ? ` OR ("scope" = 'org' AND "${ORG_COLUMN}" = '${safeOrgId}')`
        : "";
      scoped.push({
        name: table,
        viewSql: `${isPostgres ? "CREATE OR REPLACE TEMPORARY" : "CREATE TEMPORARY"} VIEW "${table}" AS SELECT * FROM ${realTable} WHERE (("scope" = 'user' AND "${OWNER_COLUMN}" = '${safeEmail}')${orgClause})${checkOption}`,
      });
      continue;
    }

    // Build WHERE clauses for owner_email and org_id
    const clauses: string[] = [];
    const hasOwner = columns.includes(OWNER_COLUMN);
    const hasOrg = columns.includes(ORG_COLUMN);

    if (hasOwner) {
      clauses.push(`"${OWNER_COLUMN}" = '${safeEmail}'`);
    }
    if (hasOrg && safeOrgId) {
      clauses.push(`"${ORG_COLUMN}" = '${safeOrgId}'`);
    }

    if (clauses.length > 0) {
      const realTable = `${qualifiedPrefix}"${table}"`;
      scoped.push({
        name: table,
        viewSql: `${isPostgres ? "CREATE OR REPLACE TEMPORARY" : "CREATE TEMPORARY"} VIEW "${table}" AS SELECT * FROM ${realTable} WHERE ${clauses.join(" AND ")}${checkOption}`,
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
  /** The current org ID (for INSERT injection in db-exec). */
  orgId: string | null;
  /** Tables that have owner_email columns (for INSERT injection). */
  ownerEmailTables: Set<string>;
  /** Tables that have org_id columns (for INSERT injection). */
  orgIdTables: Set<string>;
}

/**
 * Build scoping context for a Postgres connection.
 * Returns setup/teardown SQL to run before/after the user's query.
 */
export async function buildScopingPostgres(
  pgSql: any,
): Promise<ScopingContext> {
  const inactive: ScopingContext = {
    setup: [],
    teardown: [],
    active: false,
    userEmail: null,
    orgId: null,
    ownerEmailTables: new Set(),
    orgIdTables: new Set(),
  };

  // Scoping is always active when there is a request user (dev, preview, and
  // prod). Previously this short-circuited outside production, which created
  // a cross-user read in dev mode. See audit 05-tools-sandbox.md (C3.d).
  const userEmail = getUserEmail();
  if (!userEmail) return inactive;

  const orgId = getOrgId();
  const allColumns = await discoverColumnsPostgres(pgSql);
  const scoped = buildScopedTables(allColumns, userEmail, orgId, true);

  // Track which tables have owner_email / org_id for INSERT injection
  const columnsByTable = new Map<string, string[]>();
  for (const { table, column } of allColumns) {
    const cols = columnsByTable.get(table) || [];
    cols.push(column);
    columnsByTable.set(table, cols);
  }
  const ownerEmailTables = new Set<string>();
  const orgIdTables = new Set<string>();
  for (const [table, columns] of columnsByTable) {
    if (columns.includes(OWNER_COLUMN)) ownerEmailTables.add(table);
    if (columns.includes(ORG_COLUMN)) orgIdTables.add(table);
  }

  return {
    setup: scoped.map((s) => s.viewSql),
    teardown: scoped.map((s) => `DROP VIEW IF EXISTS pg_temp."${s.name}"`),
    active: scoped.length > 0,
    userEmail,
    orgId,
    ownerEmailTables,
    orgIdTables,
  };
}

/**
 * Build scoping context for a SQLite/libsql connection.
 * Returns setup/teardown SQL to run before/after the user's query.
 */
export async function buildScopingSqlite(client: any): Promise<ScopingContext> {
  const inactive: ScopingContext = {
    setup: [],
    teardown: [],
    active: false,
    userEmail: null,
    orgId: null,
    ownerEmailTables: new Set(),
    orgIdTables: new Set(),
  };

  // Scoping is always active when there is a request user (dev, preview, and
  // prod). Previously this short-circuited outside production, which created
  // a cross-user read in dev mode. See audit 05-tools-sandbox.md (C3.d).
  const userEmail = getUserEmail();
  if (!userEmail) return inactive;

  const orgId = getOrgId();
  const allColumns = await discoverColumnsSqlite(client);
  const scoped = buildScopedTables(allColumns, userEmail, orgId, false);

  const columnsByTable = new Map<string, string[]>();
  for (const { table, column } of allColumns) {
    const cols = columnsByTable.get(table) || [];
    cols.push(column);
    columnsByTable.set(table, cols);
  }
  const ownerEmailTables = new Set<string>();
  const orgIdTables = new Set<string>();
  for (const [table, columns] of columnsByTable) {
    if (columns.includes(OWNER_COLUMN)) ownerEmailTables.add(table);
    if (columns.includes(ORG_COLUMN)) orgIdTables.add(table);
  }

  return {
    setup: scoped.map((s) => s.viewSql),
    teardown: scoped.map((s) => `DROP VIEW IF EXISTS "${s.name}"`),
    active: scoped.length > 0,
    userEmail,
    orgId,
    ownerEmailTables,
    orgIdTables,
  };
}
