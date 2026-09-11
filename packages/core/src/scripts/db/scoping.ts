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
 *   - When both columns are present, owner_email is always required; org_id
 *     narrows to the current org while preserving legacy/personal NULL rows.
 *
 * Temp views take precedence over real tables, so the user's SQL runs
 * unmodified against the filtered views.
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
  resources: { column: "owner", mode: "exact" },
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
  predicate: string;
}

function getUserEmail(): string {
  const userEmail = getRequestUserEmail() || null;
  if (!userEmail || userEmail === DEV_FALLBACK_EMAIL) {
    throw new Error(
      "db-exec / db-query / db-patch require an authenticated user identity. " +
        "Easiest fix: open the app at http://localhost:3000 and sign in — " +
        "the CLI then auto-loads your session. Otherwise set " +
        "AGENT_USER_EMAIL=<email> in the env, or invoke through an HTTP " +
        "action that runs under runWithRequestContext. Refusing to run unscoped — " +
        "an unscoped UPDATE/DELETE would touch every user's rows, and an " +
        "unscoped INSERT would land with the dev sentinel owner and be invisible " +
        "to the UI.",
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

async function discoverColumns(client: {
  unsafe(sql: string, args?: unknown[]): Promise<unknown[]>;
}): Promise<TableColumn[]> {
  const rows = (await client.unsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `)) as Array<{ table_name: string; column_name: string }>;
  return rows.map((row) => ({
    table: row.table_name,
    column: row.column_name,
  }));
}

// ─── View generation ────────────────────────────────────────────────────────

/** Escape a string for safe inclusion in a SQL single-quoted literal. */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeIdentifier(value: string): string {
  return value.replace(/"/g, '""');
}

function buildScopedTables(
  allColumns: TableColumn[],
  userEmail: string,
  orgId: string | null,
): ScopedTable[] {
  // Group columns by table
  const columnsByTable = new Map<string, string[]>();
  for (const { table, column } of allColumns) {
    const cols = columnsByTable.get(table) || [];
    cols.push(column);
    columnsByTable.set(table, cols);
  }

  const scoped: ScopedTable[] = [];
  const safeEmail = escapeSqlString(userEmail);
  const safeOrgId = orgId ? escapeSqlString(orgId) : null;

  // WITH CHECK OPTION ensures INSERTs/UPDATEs through the auto-updatable view
  // cannot write rows that violate the filter.
  const checkOption = " WITH LOCAL CHECK OPTION";

  const viewFor = (table: string, whereSql: string): ScopedTable => {
    const escapedTable = escapeIdentifier(table);
    const realTable = `public."${escapedTable}"`;
    return {
      name: table,
      predicate: whereSql,
      viewSql: `CREATE OR REPLACE TEMPORARY VIEW "${escapedTable}" AS SELECT * FROM ${realTable} WHERE ${whereSql}${checkOption}`,
    };
  };

  for (const [table, columns] of columnsByTable) {
    // Check core table scoping
    const coreScoping = CORE_TABLE_SCOPING[table];
    if (coreScoping) {
      let whereSql: string;
      if (coreScoping.mode === "prefix") {
        // settings: key starts with u:<email>:
        // Escape \, % and _ in the email so LIKE treats them literally.
        const likeEmail = safeEmail
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        const prefix = `u:${likeEmail}:`;
        // Hide per-user credential rows (u:<email>:credential:<KEY>) from the
        // raw db-query/db-exec tools. saveCredential() now encrypts API keys
        // and third-party tokens at rest (AES-256-GCM), but the agent never
        // needs to read them via SQL — it uses them implicitly server-side.
        // Excluding them from the view is defense-in-depth: it removes a
        // prompt-injection exfiltration channel (read own secret → send to
        // attacker URL) and also hides any legacy plaintext rows that predate
        // encryption plus the recoverable last4/preview. Schema-qualified attempts
        // to reach the base table (public.settings) are
        // rejected separately by assertNoSchemaQualifiedTables in safety.ts.
        whereSql =
          `"${coreScoping.column}" LIKE '${prefix}%' ESCAPE '\\'` +
          ` AND "${coreScoping.column}" NOT LIKE '${prefix}credential:%' ESCAPE '\\'`;
      } else {
        whereSql = `"${coreScoping.column}" = '${safeEmail}'`;
      }
      scoped.push(viewFor(table, whereSql));
      continue;
    }

    if (
      table === "tool_data" &&
      columns.includes("scope") &&
      columns.includes(OWNER_COLUMN) &&
      columns.includes(ORG_COLUMN)
    ) {
      const orgClause = safeOrgId
        ? ` OR ("scope" = 'org' AND "${ORG_COLUMN}" = '${safeOrgId}')`
        : "";
      scoped.push(
        viewFor(
          table,
          `(("scope" = 'user' AND "${OWNER_COLUMN}" = '${safeEmail}')${orgClause})`,
        ),
      );
      continue;
    }

    const hasOwner = columns.includes(OWNER_COLUMN);
    const hasOrg = columns.includes(ORG_COLUMN);

    if (hasOwner) {
      const orgClause =
        hasOrg && safeOrgId
          ? ` AND ("${ORG_COLUMN}" = '${safeOrgId}' OR "${ORG_COLUMN}" IS NULL)`
          : "";
      scoped.push(
        viewFor(table, `"${OWNER_COLUMN}" = '${safeEmail}'${orgClause}`),
      );
      continue;
    }

    if (hasOrg) {
      scoped.push(
        viewFor(
          table,
          safeOrgId ? `"${ORG_COLUMN}" = '${safeOrgId}'` : "1 = 0",
        ),
      );
      continue;
    }

    // Fail closed for tables that do not advertise a scoping convention.
    // Without this shadow view, a forgotten owner_email/org_id column turns
    // into raw cross-tenant SELECT/UPDATE/DELETE access for db-* tools.
    scoped.push(viewFor(table, "1 = 0"));
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
  /** Table predicates applied by the scoping temp views. */
  tablePredicates: Map<string, string>;
}

/**
 * Build scoping context for a Postgres-shaped connection.
 * Returns setup/teardown SQL to run before/after the user's query.
 */
export async function buildScopingPostgres(client: {
  unsafe(sql: string, args?: unknown[]): Promise<unknown[]>;
}): Promise<ScopingContext> {
  // getUserEmail() throws when there is no authenticated user (no request
  // context AND no AGENT_USER_EMAIL env) or when it resolves to the dev
  // sentinel `local@localhost`. We let that throw propagate: the script
  // refuses to run unscoped rather than silently writing rows that the UI
  // then can't see, or running an UPDATE/DELETE across every user's data.
  const userEmail = getUserEmail();

  const orgId = getOrgId();
  const allColumns = await discoverColumns(client);
  const scoped = buildScopedTables(allColumns, userEmail, orgId);

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
    teardown: scoped.map(
      (s) => `DROP VIEW IF EXISTS pg_temp."${escapeIdentifier(s.name)}"`,
    ),
    active: scoped.length > 0,
    userEmail,
    orgId,
    ownerEmailTables,
    orgIdTables,
    tablePredicates: new Map(scoped.map((s) => [s.name, s.predicate])),
  };
}
