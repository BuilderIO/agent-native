
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
  const columnsByTable = new Map<string, string[]>();
  for (const { table, column } of allColumns) {
    const cols = columnsByTable.get(table) || [];
    cols.push(column);
    columnsByTable.set(table, cols);
  }

  const scoped: ScopedTable[] = [];
  const safeEmail = escapeSqlString(userEmail);
  const safeOrgId = orgId ? escapeSqlString(orgId) : null;

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
    const coreScoping = CORE_TABLE_SCOPING[table];
    if (coreScoping) {
      let whereSql: string;
      if (coreScoping.mode === "prefix") {
        const likeEmail = safeEmail
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        const prefix = `u:${likeEmail}:`;
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

    scoped.push(viewFor(table, "1 = 0"));
  }

  return scoped;
}


export interface ScopingContext {
  setup: string[];
  teardown: string[];
  active: boolean;
  userEmail: string | null;
  orgId: string | null;
  ownerEmailTables: Set<string>;
  orgIdTables: Set<string>;
  tablePredicates: Map<string, string>;
}

export async function buildScopingPostgres(client: {
  unsafe(sql: string, args?: unknown[]): Promise<unknown[]>;
}): Promise<ScopingContext> {
  const userEmail = getUserEmail();

  const orgId = getOrgId();
  const allColumns = await discoverColumns(client);
  const scoped = buildScopedTables(allColumns, userEmail, orgId);

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
