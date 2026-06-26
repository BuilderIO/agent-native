import { getDbExec } from "@agent-native/core/db";

/**
 * The `app` panel data source: lets SQL dashboards read the app's OWN
 * org-scoped curated tables (not BigQuery/GA4/etc). This is what makes the
 * migrated "Strategic Account Coverage" and "Implementation Blockers" children
 * genuinely SQL-backed without copying sensitive data into source or pushing it
 * to the warehouse — the data lives only in these local org-scoped tables.
 *
 * Security model mirrors first-party analytics: only a single read-only SELECT
 * is allowed, only whitelisted tables may be referenced, and every whitelisted
 * table reference is rewritten into a scoped subquery so a caller can only ever
 * read their own org's (or, org-less, their own) rows.
 */

export interface AppQueryScope {
  userEmail: string;
  orgId: string | null;
}

export interface AppQueryResult {
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
}

const MAX_QUERY_ROWS = 5_000;

/**
 * Tables a dashboard panel may read via the `app` source. Every table here
 * MUST expose ownableColumns (owner_email, org_id) so the scope filter below is
 * valid — do not add a table without those columns.
 */
const ALLOWED_TABLES = new Set([
  "strategic_accounts",
  "strategic_account_contacts",
  "implementation_blockers",
]);

const RESERVED_ALIAS_WORDS = new Set([
  "where",
  "on",
  "group",
  "order",
  "limit",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "cross",
  "full",
  "having",
  "union",
]);

/** Blank out string literals and comments so they can't hide table refs. */
function stripSqlLiterals(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

export function validateAppSql(sql: string): void {
  const stripped = stripSqlLiterals(sql).trim();
  const lowered = stripped.toLowerCase();
  if (!/^(select|with)\b/.test(lowered)) {
    throw new Error("App queries must start with SELECT or WITH");
  }
  if (stripped.includes(";")) {
    throw new Error("Only a single SELECT statement is allowed");
  }
  if (
    /\b(insert|update|delete|drop|alter|truncate|create|replace|pragma|attach|detach|vacuum|grant|revoke)\b/i.test(
      stripped,
    )
  ) {
    throw new Error("Only read-only SELECT queries are allowed");
  }
  if (stripped.includes("?") || /\$\d+\b/.test(stripped)) {
    throw new Error("Bind placeholders are not supported in dashboard SQL");
  }

  const cteNames = new Set<string>();
  const cteRe = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi;
  for (const match of stripped.matchAll(cteRe)) {
    cteNames.add(match[1].toLowerCase());
  }

  let usesAllowed = false;
  const tableRe = /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  for (const match of stripped.matchAll(tableRe)) {
    const ref = match[1].toLowerCase();
    if (ALLOWED_TABLES.has(ref)) {
      usesAllowed = true;
      continue;
    }
    if (cteNames.has(ref)) continue;
    throw new Error(
      `App queries can only read ${[...ALLOWED_TABLES].join(", ")} (found ${match[1]})`,
    );
  }
  if (!usesAllowed) {
    throw new Error(
      `Query must read from one of: ${[...ALLOWED_TABLES].join(", ")}`,
    );
  }
}

function scopeClause(scope: AppQueryScope): {
  sql: string;
  args: Array<string | null>;
} {
  if (scope.orgId) {
    return {
      sql: "(org_id = ? OR (org_id IS NULL AND owner_email = ?))",
      args: [scope.orgId, scope.userEmail],
    };
  }
  return {
    sql: "(org_id IS NULL AND owner_email = ?)",
    args: [scope.userEmail],
  };
}

function scopedAppSql(
  sql: string,
  scope: AppQueryScope,
): { sql: string; args: Array<string | null> } {
  const args: Array<string | null> = [];
  const tableAlt = [...ALLOWED_TABLES].join("|");
  const aliasRe = new RegExp(
    `\\b(from|join)\\s+(${tableAlt})\\b(\\s+(?:as\\s+)?(?!where\\b|on\\b|group\\b|order\\b|limit\\b|join\\b|left\\b|right\\b|inner\\b|outer\\b|cross\\b|full\\b|having\\b|union\\b)([a-zA-Z_][a-zA-Z0-9_]*))?`,
    "gi",
  );
  const rewritten = sql.replace(
    aliasRe,
    (_full, keyword, tableName, aliasPart, alias) => {
      const normalizedAlias =
        typeof alias === "string" ? alias.toLowerCase() : "";
      const usableAlias =
        aliasPart &&
        normalizedAlias &&
        !RESERVED_ALIAS_WORDS.has(normalizedAlias)
          ? aliasPart
          : ` AS ${tableName}`;
      const scopeDef = scopeClause(scope);
      args.push(...scopeDef.args);
      return `${keyword} (SELECT * FROM ${tableName} WHERE ${scopeDef.sql})${usableAlias}`;
    },
  );
  return { sql: rewritten, args };
}

function valueType(value: unknown): string {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function inferSchema(rows: Record<string, unknown>[]): {
  name: string;
  type: string;
}[] {
  const first = rows.find((row) => row && typeof row === "object");
  if (!first) return [];
  return Object.entries(first).map(([name, value]) => ({
    name,
    type: valueType(value),
  }));
}

export async function queryAppTables(
  sql: string,
  scope: AppQueryScope,
): Promise<AppQueryResult> {
  validateAppSql(sql);
  const scoped = scopedAppSql(sql, scope);
  const exec = getDbExec();
  const result = await exec.execute({
    sql: `SELECT * FROM (${scoped.sql}) AS app_query LIMIT ${MAX_QUERY_ROWS}`,
    args: scoped.args,
  });
  const rows = result.rows as Record<string, unknown>[];
  return { rows, schema: inferSchema(rows) };
}
