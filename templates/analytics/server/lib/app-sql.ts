import { getDbExec } from "@agent-native/core/db";
import { accessFilter } from "@agent-native/core/sharing";

import { getDb, schema } from "../db/index.js";

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
/**
 * Maps each readable table to its drizzle table + shares table so the scoped
 * subquery can be built from the SAME `accessFilter` the store/action layer
 * uses — honoring visibility (private/org/public) and explicit share rows, not
 * just owner/org_id.
 */
const ALLOWED_TABLES_MAP: Record<
  string,
  { table: any; shares: any }
> = {
  strategic_accounts: {
    table: schema.strategicAccounts,
    shares: schema.strategicAccountShares,
  },
  strategic_account_contacts: {
    table: schema.strategicAccountContacts,
    shares: schema.strategicAccountContactShares,
  },
  implementation_blockers: {
    table: schema.implementationBlockers,
    shares: schema.implementationBlockerShares,
  },
};

const ALLOWED_TABLES = new Set(Object.keys(ALLOWED_TABLES_MAP));

/** Keywords that can follow a table spec and end the FROM/JOIN table list. */
const CLAUSE_STOP_WORDS = new Set([
  "where",
  "group",
  "order",
  "limit",
  "having",
  "union",
  "except",
  "intersect",
  "on",
  "using",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "cross",
  "full",
  "natural",
  "select",
  "window",
  "returning",
  "as",
  "and",
  "or",
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

/** Advance past a balanced parenthesized group starting at `open` ('('). */
function skipBalancedParens(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/**
 * Extract every table identifier that appears in a FROM/JOIN table position,
 * including comma-separated lists. Derived tables (subqueries) are skipped here
 * because their inner FROM/JOIN is matched independently. Throws on
 * comma-style joins, which the scoping rewriter cannot safely rewrite.
 */
function extractTableRefs(stripped: string): string[] {
  const refs: string[] = [];
  const kw = /\b(from|join)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = kw.exec(stripped))) {
    let i = m.index + m[0].length;
    while (i < stripped.length && /\s/.test(stripped[i])) i++;
    if (stripped[i] === "(") {
      // Derived table / subquery; its inner FROM is matched by the outer scan.
      continue;
    }
    const idMatch = /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*/.exec(
      stripped.slice(i),
    );
    if (!idMatch) continue;
    const ident = idMatch[0];
    if (CLAUSE_STOP_WORDS.has(ident.toLowerCase())) continue;
    refs.push(ident);
    i += ident.length;

    // Optional alias: [AS] <identifier> (unless it's a clause keyword).
    while (i < stripped.length && /\s/.test(stripped[i])) i++;
    const aliasMatch = /^(?:as\s+)?[A-Za-z_][A-Za-z0-9_$]*/i.exec(
      stripped.slice(i),
    );
    if (aliasMatch) {
      const aliasWord = aliasMatch[0].replace(/^as\s+/i, "").toLowerCase();
      if (!CLAUSE_STOP_WORDS.has(aliasWord)) i += aliasMatch[0].length;
    }
    while (i < stripped.length && /\s/.test(stripped[i])) i++;
    if (stripped[i] === ",") {
      throw new Error(
        "Comma joins are not allowed in dashboard SQL; use an explicit JOIN",
      );
    }
  }
  return refs;
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
  // Quoted identifiers ("user", `user`, [user]) could smuggle in tables that
  // the plain-identifier allow-list never inspects. Our curated tables/columns
  // are all bare snake_case, so reject quoting outright.
  if (/["`\[\]]/.test(stripped)) {
    throw new Error("Quoted identifiers are not allowed in dashboard SQL");
  }

  const cteNames = new Set<string>();
  const cteRe = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi;
  for (const match of stripped.matchAll(cteRe)) {
    cteNames.add(match[1].toLowerCase());
  }

  let usesAllowed = false;
  for (const ref of extractTableRefs(stripped)) {
    const lower = ref.toLowerCase();
    if (lower.includes(".")) {
      throw new Error(
        `Schema-qualified table names are not allowed (found ${ref})`,
      );
    }
    if (ALLOWED_TABLES.has(lower)) {
      usesAllowed = true;
      continue;
    }
    if (cteNames.has(lower)) continue;
    throw new Error(
      `App queries can only read ${[...ALLOWED_TABLES].join(", ")} (found ${ref})`,
    );
  }
  if (!usesAllowed) {
    throw new Error(
      `Query must read from one of: ${[...ALLOWED_TABLES].join(", ")}`,
    );
  }
}

/**
 * Build the scoped subquery for one allowed table by compiling the SAME
 * `accessFilter` predicate the store layer uses. This guarantees app-source
 * dashboard reads honor each row's visibility AND explicit user/org shares
 * (and the resource's org-only policy) — not just owner_email/org_id.
 */
function scopedTableSubquery(
  tableName: string,
  scope: AppQueryScope,
): { sql: string; args: unknown[] } {
  const entry = ALLOWED_TABLES_MAP[tableName.toLowerCase()];
  if (!entry) {
    // Should never happen: validateAppSql already rejected unknown tables.
    throw new Error(`Table not readable via app source: ${tableName}`);
  }
  const db = getDb() as any;
  const where = accessFilter(entry.table, entry.shares, {
    userEmail: scope.userEmail,
    orgId: scope.orgId ?? undefined,
  });
  const compiled = db.select().from(entry.table).where(where).toSQL();
  return { sql: compiled.sql as string, args: (compiled.params ?? []) as unknown[] };
}

function scopedAppSql(
  sql: string,
  scope: AppQueryScope,
): { sql: string; args: unknown[] } {
  const args: unknown[] = [];
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
      const sub = scopedTableSubquery(tableName, scope);
      args.push(...sub.args);
      return `${keyword} (${sub.sql})${usableAlias}`;
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
