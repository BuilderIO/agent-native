/**
 * Auto-introspected SQL schema context block for the agent's system prompt.
 *
 * On every chat turn, the framework appends a compact, always-fresh summary
 * of the app's SQL database — every table, every column, every foreign key —
 * so the agent knows exactly what data model it's working with. The schema
 * is pulled live from `information_schema` (Postgres) or `PRAGMA table_info`
 * (SQLite), cached briefly to keep latency down but never hard-coded.
 *
 * The block also:
 *   - points at the db-query / db-exec / db-patch / db-schema tools for runtime access
 *   - lists Postgres column descriptions (`COMMENT ON COLUMN ...`) if present
 *   - explains the current user/org data scoping so the agent doesn't re-filter
 *     by hand (which would be redundant and easy to get wrong)
 */
import {
  getDbExec,
  getDatabaseUrl,
  isPostgres,
  type DbExec,
} from "../db/client.js";

interface ColumnSchema {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
  comment: string | null;
}

interface ForeignKey {
  from: string;
  table: string;
  to: string;
}

interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  foreignKeys: ForeignKey[];
  comment: string | null;
}

// Short-lived in-memory cache — schema rarely changes between messages, but
// we want new tables to show up within a few seconds during active dev.
const CACHE_TTL_MS = 15_000;
let _cache: {
  key: string;
  expires: number;
  tables: TableSchema[];
  dialect: "postgres" | "sqlite";
} | null = null;

function cacheKey(): string {
  return (isPostgres() ? "pg:" : "lite:") + (getDatabaseUrl() || "");
}

// ─── Postgres introspection ─────────────────────────────────────────────────

async function introspectPostgres(db: DbExec): Promise<TableSchema[]> {
  const tablesRes = await db.execute({
    sql: `SELECT table_name AS name,
                 obj_description((quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass, 'pg_class') AS comment
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name`,
    args: [],
  });

  const tables: TableSchema[] = [];

  for (const t of tablesRes.rows as any[]) {
    const name = t.name as string;

    const colsRes = await db.execute({
      sql: `SELECT c.column_name AS name,
                   c.data_type AS type,
                   CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
                   col_description((quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass, c.ordinal_position) AS comment
            FROM information_schema.columns c
            WHERE c.table_name = ? AND c.table_schema = 'public'
            ORDER BY c.ordinal_position`,
      args: [name],
    });

    const pksRes = await db.execute({
      sql: `SELECT kcu.column_name AS name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_name = ? AND tc.constraint_type = 'PRIMARY KEY'`,
      args: [name],
    });
    const pkSet = new Set((pksRes.rows as any[]).map((r) => r.name as string));

    const fksRes = await db.execute({
      sql: `SELECT kcu.column_name AS col_from,
                   ccu.table_name  AS ref_table,
                   ccu.column_name AS ref_col
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
            WHERE tc.table_name = ? AND tc.constraint_type = 'FOREIGN KEY'`,
      args: [name],
    });

    tables.push({
      name,
      comment: (t.comment as string | null) ?? null,
      columns: (colsRes.rows as any[]).map((c) => ({
        name: c.name as string,
        type: (c.type as string) || "any",
        notnull: Number(c.notnull) === 1,
        pk: pkSet.has(c.name as string),
        comment: (c.comment as string | null) ?? null,
      })),
      foreignKeys: (fksRes.rows as any[]).map((f) => ({
        from: f.col_from as string,
        table: f.ref_table as string,
        to: f.ref_col as string,
      })),
    });
  }

  return tables;
}

// ─── SQLite / libSQL / D1 introspection ────────────────────────────────────

async function introspectSqlite(db: DbExec): Promise<TableSchema[]> {
  const tablesRes = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );

  const tables: TableSchema[] = [];

  for (const row of tablesRes.rows as any[]) {
    const name = row.name as string;
    if (!name) continue;
    // Quote the identifier for PRAGMA calls; SQLite requires doubling embedded quotes.
    const escaped = name.replace(/"/g, '""');

    const colsRes = await db.execute(`PRAGMA table_info("${escaped}")`);
    const fksRes = await db.execute(`PRAGMA foreign_key_list("${escaped}")`);

    tables.push({
      name,
      comment: null, // SQLite has no column/table comments
      columns: (colsRes.rows as any[]).map((c) => ({
        name: c.name as string,
        type: ((c.type as string) || "").toLowerCase() || "any",
        notnull: Number(c.notnull) === 1,
        pk: Number(c.pk) === 1,
        comment: null,
      })),
      foreignKeys: (fksRes.rows as any[]).map((f) => ({
        from: f.from as string,
        table: f.table as string,
        to: f.to as string,
      })),
    });
  }

  return tables;
}

// ─── Cached entry point ─────────────────────────────────────────────────────

async function getSchema(): Promise<{
  tables: TableSchema[];
  dialect: "postgres" | "sqlite";
}> {
  const key = cacheKey();
  const now = Date.now();
  if (_cache && _cache.key === key && _cache.expires > now) {
    return { tables: _cache.tables, dialect: _cache.dialect };
  }

  const db = getDbExec();
  const dialect: "postgres" | "sqlite" = isPostgres() ? "postgres" : "sqlite";
  const tables =
    dialect === "postgres"
      ? await introspectPostgres(db)
      : await introspectSqlite(db);

  _cache = { key, expires: now + CACHE_TTL_MS, tables, dialect };
  return { tables, dialect };
}

/** Manually drop the cache — useful from tests or after running a migration. */
export function invalidateSchemaPromptCache(): void {
  _cache = null;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function shortType(type: string): string {
  // Trim verbose Postgres type names for compactness in the prompt.
  const t = type.toLowerCase();
  if (t === "character varying") return "varchar";
  if (t === "timestamp without time zone") return "timestamp";
  if (t === "timestamp with time zone") return "timestamptz";
  if (t === "double precision") return "double";
  return t;
}

function formatTable(table: TableSchema): string {
  const fkByCol = new Map<string, string>();
  for (const fk of table.foreignKeys) {
    fkByCol.set(fk.from, `${fk.table}.${fk.to}`);
  }

  const cols = table.columns.map((c) => {
    const flags: string[] = [];
    if (c.pk) flags.push("pk");
    if (!c.notnull && !c.pk) flags.push("null");
    const fk = fkByCol.get(c.name);
    if (fk) flags.push(`→${fk}`);

    // Flag scoping columns so the agent understands per-user/per-org filtering.
    if (c.name === "owner_email") flags.push("user-scope");
    if (c.name === "org_id") flags.push("org-scope");

    const flagStr = flags.length ? ` [${flags.join(", ")}]` : "";
    const commentStr = c.comment ? ` -- ${c.comment.replace(/\s+/g, " ")}` : "";
    return `    ${c.name} ${shortType(c.type)}${flagStr}${commentStr}`;
  });

  const header = table.comment
    ? `  ${table.name}  -- ${table.comment.replace(/\s+/g, " ")}`
    : `  ${table.name}`;

  return [header, ...cols].join("\n");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the `<sql-database>` block appended to the system prompt on every turn.
 *
 * `owner` and `orgId` come from the per-request context (AGENT_USER_EMAIL /
 * AGENT_ORG_ID) and are surfaced so the agent knows who it is acting on behalf
 * of — and understands that rows are already filtered for that identity.
 */
export async function loadSchemaPromptBlock(opts: {
  owner?: string | null;
  orgId?: string | null;
  /** If true, mention db-query/db-exec/db-patch/db-schema as available tools. */
  hasRawDbTools?: boolean;
}): Promise<string> {
  let tables: TableSchema[];
  let dialect: "postgres" | "sqlite";
  try {
    const res = await getSchema();
    tables = res.tables;
    dialect = res.dialect;
  } catch (err) {
    // DB not ready, or introspection blew up — don't take the chat down.
    return "";
  }

  if (tables.length === 0) return "";

  // Partition framework-internal tables from template tables so the agent
  // focuses on the data model it's most likely to touch.
  const CORE_TABLES = new Set([
    "application_state",
    "settings",
    "oauth_tokens",
    "sessions",
    "resources",
    "chat_threads",
    "_collab_docs",
    "usage_events",
    "usage_totals",
    "user",
    "account",
    "verification",
    "organization",
    "member",
    "invitation",
  ]);

  const templateTables = tables.filter((t) => !CORE_TABLES.has(t.name));
  const coreTables = tables.filter((t) => CORE_TABLES.has(t.name));

  const lines: string[] = [];
  lines.push("<sql-database>");
  lines.push(
    `The app's state lives in a SQL database (${dialect}). The schema below is auto-introspected fresh each turn — treat it as authoritative.`,
  );
  lines.push("");

  if (templateTables.length > 0) {
    lines.push("## Template tables");
    lines.push("");
    for (const t of templateTables) {
      lines.push(formatTable(t));
      lines.push("");
    }
  }

  if (coreTables.length > 0) {
    lines.push(
      "## Framework tables (auth, resources, chat threads, app-state, etc.) — usually read/written via dedicated tools, not raw SQL",
    );
    lines.push("");
    for (const t of coreTables) {
      lines.push(formatTable(t));
      lines.push("");
    }
  }

  // Tooling references.
  if (opts.hasRawDbTools) {
    lines.push("## SQL tools");
    lines.push(
      "- `db-schema` — refresh the full schema with indexes and foreign keys",
    );
    lines.push(
      "- `db-query` — run a SELECT (read-only; results already filtered to the current user/org)",
    );
    lines.push(
      "- `db-exec` — run INSERT / UPDATE / DELETE (writes already scoped; owner_email and org_id are auto-injected on INSERT)",
    );
    lines.push(
      "- `db-patch` — surgical search-and-replace on a large text column. Send `{find, replace}` pairs instead of the full new value. Use this for edits to large fields (documents, slide HTML, dashboard/form JSON) — it avoids re-sending multi-kilobyte strings and saves tokens. Targets exactly one row (narrow `--where` by primary key). Uses the same per-user/per-org scoping as db-exec.",
    );
    lines.push("");
    lines.push("### When to pick which SQL tool");
    lines.push(
      "- Set a short column outright, update multiple columns, or do computed updates (`calories = calories + 50`) → `db-exec UPDATE`.",
    );
    lines.push(
      "- Change a small slice of a large text/JSON column → `db-patch`. Much cheaper token-wise than re-sending the whole column.",
    );
    lines.push(
      "- A template-specific action exists for the table (`edit-document`, `update-slide`, etc.) → use that action. It encodes business rules and pushes live Yjs updates to any open collaborative editor; raw SQL does neither.",
    );
    lines.push(
      "- Read data → `db-query`. Never re-add `WHERE owner_email = ...` — scoping already applies it.",
    );
    lines.push("");
    lines.push("### External data sources vs the app database");
    lines.push(
      "The `db-*` tools ONLY query the app's own SQL database (the tables listed above). They do NOT reach external data warehouses, analytics platforms, or third-party services.",
    );
    lines.push(
      "If the user asks about tables that are NOT in the schema above (e.g. `dbt_analytics.*`, `dbt_intermediate.*`, warehouse tables, or any table you don't see listed), use the appropriate template action instead — for example `bigquery` for BigQuery/dbt tables, `ga4-report` for Google Analytics, `hubspot-deals` for HubSpot, etc. Check your available actions for the right data-source-specific tool.",
    );
    lines.push(
      "**Never use `db-query` for external data.** It will fail because those tables don't exist in the app database.",
    );
    lines.push("");
  } else {
    lines.push(
      "SQL is accessed through the template actions listed above. The schema is shown for context — so you understand the data model those actions operate on.",
    );
    lines.push("");
  }

  // Data scoping context.
  const ownerLine = opts.owner ? opts.owner : "(unresolved)";
  const orgLine = opts.orgId ? opts.orgId : "(none)";
  lines.push("## Data scoping (enforced at the SQL layer)");
  lines.push(`- Current user: \`${ownerLine}\``);
  lines.push(`- Current org:  \`${orgLine}\``);
  lines.push(
    "- Tables with an `owner_email` column are automatically filtered to the current user via temporary views before every query.",
  );
  lines.push(
    "- Tables with an `org_id` column are automatically filtered to the current org as well.",
  );
  lines.push(
    "- On INSERT, `owner_email` and `org_id` are auto-injected — do NOT set them manually.",
  );
  lines.push(
    "- Do NOT add `WHERE owner_email = ...` or `WHERE org_id = ...` to your queries — the filter is already applied, and re-adding it will confuse the scoped view.",
  );
  lines.push("</sql-database>");

  return "\n\n" + lines.join("\n");
}
