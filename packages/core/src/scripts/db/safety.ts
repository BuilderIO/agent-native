import type { AgentSqlToken } from "../../agent-sql/lexer.js";
import {
  AgentSqlPolicyError,
  assertAgentPostgresTokenPolicy,
  readAgentPostgresStatement,
  verifyAgentPostgresResolution,
  type AgentPostgresStatement,
  type AgentSqlQueryRunner,
} from "../../agent-sql/postgres.js";
import { toPostgresParams } from "../../db/client.js";
import { fail } from "../utils.js";

// Every guard here reads the SQL with the shared agent-SQL lexer, so strings,
// comments, quoted identifiers and dollar quotes are seen the way Postgres
// sees them. Text the lexer cannot read is refused rather than skipped.

function guarded<T>(check: () => T, label?: string): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof AgentSqlPolicyError) {
      fail(prefixed(label, error.message));
    }
    throw error;
  }
}

async function guardedAsync(
  check: () => Promise<void>,
  label?: string,
): Promise<void> {
  try {
    await check();
  } catch (error) {
    if (error instanceof AgentSqlPolicyError) {
      fail(prefixed(label, error.message));
    }
    throw error;
  }
}

function prefixed(label: string | undefined, message: string): string {
  return label ? `${label}: ${message}` : message;
}

function isName(token: AgentSqlToken | undefined): token is AgentSqlToken {
  return token?.kind === "word" || token?.kind === "quoted-identifier";
}

function isWord(token: AgentSqlToken | undefined, value: string): boolean {
  return token?.kind === "word" && token.value === value;
}

function isPunctuation(token: AgentSqlToken | undefined, text: string) {
  return token?.kind === "punctuation" && token.text === text;
}

const SENSITIVE_FRAMEWORK_TABLES = new Set([
  "app_secrets",
  "oauth_tokens",
  "mcp_oauth_clients",
  "mcp_oauth_codes",
  "mcp_oauth_refresh_tokens",
  "mcp_connect_tokens",
  "mcp_device_codes",
  "user",
  "users",
  "session",
  "sessions",
  "account",
  "accounts",
  "verification",
  "jwks",
  "organization",
  "member",
  "invitation",
  "org_members",
  "org_invitations",
  "pg_catalog",
  "information_schema",
  "pg_class",
  "pg_proc",
  "pg_namespace",
  "pg_user",
  "pg_roles",
  "pg_authid",
  "pg_shadow",
]);

function sensitiveVerb(operation: "read" | "write" | "patch"): string {
  return operation === "read"
    ? "readable"
    : operation === "write"
      ? "writable"
      : "patchable";
}

function assertNoSensitiveFrameworkTableTokens(
  tokens: AgentSqlToken[],
  operation: "read" | "write" | "patch",
): void {
  for (const token of tokens) {
    if (!isName(token)) continue;
    const name = token.value.toLowerCase();
    if (!SENSITIVE_FRAMEWORK_TABLES.has(name)) continue;
    fail(
      `Sensitive framework table "${name}" is not ${sensitiveVerb(operation)} through raw DB tools. Use the framework auth, secrets, or OAuth APIs instead.`,
    );
  }
}

export function assertNoSensitiveFrameworkTables(
  sql: string,
  operation: "read" | "write" | "patch",
): void {
  const statement = guarded(() => readAgentPostgresStatement(sql));
  assertNoSensitiveFrameworkTableTokens(statement.tokens, operation);
}

const READ_KEYWORDS = new Set(["select", "with", "explain"]);
const WRITE_KEYWORDS = new Set(["insert", "update", "delete"]);

/**
 * Reads one db-query statement and applies every check that needs no
 * database. Returns the statement as it will run.
 */
export function readRawDbReadStatement(sql: string): AgentPostgresStatement {
  const statement = guarded(() => readAgentPostgresStatement(sql));
  if (!statement.keyword || !READ_KEYWORDS.has(statement.keyword)) {
    fail(
      "Only SELECT, WITH, and EXPLAIN queries are allowed. Use db-exec for writes.",
    );
  }
  guarded(() => assertAgentPostgresTokenPolicy(statement));
  assertNoSensitiveFrameworkTableTokens(statement.tokens, "read");
  return statement;
}

/**
 * Reads one db-exec statement and applies every check that needs no
 * database, including the access-control write rules. `label` prefixes
 * errors, e.g. "Statement 2".
 */
export function readRawDbWriteStatement(
  sql: string,
  label?: string,
): AgentPostgresStatement {
  const statement = guarded(() => {
    try {
      return readAgentPostgresStatement(sql);
    } catch (error) {
      if (!(error instanceof AgentSqlPolicyError)) throw error;
      const subject = label ?? "The statement";
      if (error.code === "multiple_statements") {
        fail(
          `${subject} contains multiple SQL statements. Use --statements for batches so each write can be validated and run transactionally.`,
        );
      }
      if (error.code === "empty") fail(`${subject} is empty`);
      throw error;
    }
  }, label);
  assertRawDbWriteKeyword(statement, label);
  guarded(() => assertAgentPostgresTokenPolicy(statement), label);
  assertNoSensitiveFrameworkTableTokens(statement.tokens, "write");
  assertNoRawDbAccessControlWriteTokens(statement, label);
  return statement;
}

function assertRawDbWriteKeyword(
  statement: AgentPostgresStatement,
  label: string | undefined,
): void {
  const keyword = statement.keyword ?? "";
  if (READ_KEYWORDS.has(keyword)) {
    fail(
      prefixed(
        label,
        "use db-query for read statements. db-exec is for writes only.",
      ),
    );
  }
  if (keyword === "create" || keyword === "alter") {
    fail(
      prefixed(
        label,
        "schema changes are not allowed through db-exec. Additive schema changes must go through reviewed migrations or startup code.",
      ),
    );
  }
  if (!WRITE_KEYWORDS.has(keyword)) {
    fail(
      prefixed(
        label,
        "only INSERT, UPDATE, DELETE statements are allowed. Dangerous operations such as DROP, TRUNCATE, GRANT, and REVOKE are blocked.",
      ),
    );
  }
}

/**
 * Converts `?` placeholders and re-reads the result, so the guards have seen
 * exactly the text that executes. Refuses if converting again would change
 * the text, since the PGlite client converts a second time.
 */
export function finalRawDbSql(
  sql: string,
  kind: "read" | "write" | "patch",
  label?: string,
): { sql: string; statement: AgentPostgresStatement } {
  const finalSql = toPostgresParams(sql);
  if (toPostgresParams(finalSql) !== finalSql) {
    fail(
      prefixed(
        label,
        "The SQL could not be read safely: its placeholders are ambiguous.",
      ),
    );
  }
  const statement = guarded(() => readAgentPostgresStatement(finalSql), label);
  // toPostgresParams converts every "?" it reads as code. One left over means
  // it read that text as a string or comment and Postgres will not, so the
  // two disagree about where the statement's code is.
  if (
    statement.tokens.some(
      (token) =>
        (token.kind === "parameter" || token.kind === "operator") &&
        token.text.includes("?"),
    )
  ) {
    fail(
      prefixed(
        label,
        "The SQL could not be read safely: its placeholders are ambiguous.",
      ),
    );
  }
  if (kind === "read") {
    if (!statement.keyword || !READ_KEYWORDS.has(statement.keyword)) {
      fail("Only SELECT, WITH, and EXPLAIN queries are allowed.");
    }
  } else if (kind === "patch") {
    if (statement.keyword !== "update") {
      fail("--where must be a single condition.");
    }
  } else {
    assertRawDbWriteKeyword(statement, label);
  }
  guarded(() => assertAgentPostgresTokenPolicy(statement), label);
  assertNoSensitiveFrameworkTableTokens(statement.tokens, kind);
  return { sql: finalSql, statement };
}

/**
 * The database-side checks: run inside the transaction, after the per-user
 * views exist and immediately before the statement executes.
 * `columnsByTable` comes from the scoping context; it lets an INSERT without a
 * column list be refused when the table has access-control columns.
 */
export async function verifyRawDbStatement(
  db: AgentSqlQueryRunner,
  statement: AgentPostgresStatement,
  options: { columnsByTable?: Map<string, string[]>; label?: string } = {},
): Promise<void> {
  await guardedAsync(
    () => verifyAgentPostgresResolution(db, statement),
    options.label,
  );
  if (statement.keyword !== "insert" || !options.columnsByTable) return;
  const target = writeTarget(statement);
  if (!target || target.insertColumns !== null) return;
  const columns = options.columnsByTable.get(target.table) ?? [];
  const sensitive = columns.find((column) =>
    hasSensitiveToken(column, ACCESS_CONTROL_COLUMN_TOKENS),
  );
  if (sensitive) {
    fail(
      prefixed(
        options.label,
        `INSERT into "${target.table}" must list its columns, because the table has the access-control column "${sensitive}". Name the columns you are setting.`,
      ),
    );
  }
}

const ACCESS_CONTROL_TABLE_TOKENS = new Set([
  "acl",
  "access",
  "admin",
  "admins",
  "grant",
  "grants",
  "invitation",
  "invitations",
  "invite",
  "invites",
  "member",
  "members",
  "permission",
  "permissions",
  "privilege",
  "privileges",
  "role",
  "roles",
  "user",
  "users",
]);

const ACCESS_CONTROL_COLUMN_TOKENS = new Set([
  "access",
  "access_level",
  "acl",
  "admin",
  "admins",
  "grant",
  "grants",
  "is_admin",
  "is_owner",
  "member",
  "members",
  "owner",
  "owner_email",
  "permission",
  "permissions",
  "privilege",
  "privileges",
  "role",
  "roles",
]);

function identifierTokens(identifier: string): Set<string> {
  const normalized = identifier.trim().toLowerCase();
  const tokens = new Set<string>([normalized]);
  for (const token of normalized.split(/[^a-z0-9]+/).filter(Boolean)) {
    tokens.add(token);
  }
  return tokens;
}

function hasSensitiveToken(
  identifier: string,
  sensitiveTokens: Set<string>,
): string | null {
  for (const token of identifierTokens(identifier)) {
    if (sensitiveTokens.has(token)) return token;
  }
  return null;
}

interface WriteTarget {
  table: string;
  /** Columns named by INSERT, or null when it names none and so writes all. */
  insertColumns: string[] | null;
  /** Columns assigned in any SET clause, including ON CONFLICT DO UPDATE. */
  setColumns: string[];
}

/** Reads `name` or `a.b.name` at `index`; returns the last name and the next index. */
function readNameChain(
  tokens: AgentSqlToken[],
  index: number,
): { name: string; next: number } | null {
  if (!isName(tokens[index])) return null;
  let cursor = index;
  while (isPunctuation(tokens[cursor + 1], ".") && isName(tokens[cursor + 2])) {
    cursor += 2;
  }
  return { name: tokens[cursor].value, next: cursor + 1 };
}

const PARENTHESIZED_QUERY_KEYWORDS = new Set([
  "select",
  "with",
  "values",
  "table",
]);

function isOpening(token: AgentSqlToken | undefined): boolean {
  return isPunctuation(token, "(") || isPunctuation(token, "[");
}

function isClosing(token: AgentSqlToken | undefined): boolean {
  return isPunctuation(token, ")") || isPunctuation(token, "]");
}

/**
 * The table an INSERT writes and the columns it lists, or null when the
 * statement is not an INSERT the guards can read. `columns` is null when the
 * INSERT has no column list.
 */
export function rawDbInsertTarget(
  statement: AgentPostgresStatement,
): { table: string; columns: string[] | null } | null {
  if (statement.keyword !== "insert") return null;
  const target = writeTarget(statement);
  return target ? { table: target.table, columns: target.insertColumns } : null;
}

function writeTarget(statement: AgentPostgresStatement): WriteTarget | null {
  const { tokens } = statement;
  let index = 1;
  if (statement.keyword === "insert") {
    if (!isWord(tokens[index], "into")) return null;
    index++;
  } else if (statement.keyword === "delete") {
    if (!isWord(tokens[index], "from")) return null;
    index++;
  } else if (statement.keyword !== "update") {
    return null;
  }
  if (isWord(tokens[index], "only")) index++;
  const chain = readNameChain(tokens, index);
  if (!chain) return null;

  let insertColumns: string[] | null = null;
  if (statement.keyword === "insert") {
    let cursor = chain.next;
    if (isWord(tokens[cursor], "as")) cursor += 2;
    const opensQuery =
      isPunctuation(tokens[cursor + 1], "(") ||
      (tokens[cursor + 1]?.kind === "word" &&
        PARENTHESIZED_QUERY_KEYWORDS.has(tokens[cursor + 1].value));
    // `INSERT INTO t (SELECT ...)` is a parenthesized query, not a column list.
    if (isPunctuation(tokens[cursor], "(") && !opensQuery) {
      insertColumns = [];
      let depth = 0;
      for (; cursor < tokens.length; cursor++) {
        const token = tokens[cursor];
        if (isOpening(token)) depth++;
        else if (isClosing(token) && --depth === 0) break;
        else if (isName(token)) insertColumns.push(token.value);
      }
    } else if (isWord(tokens[cursor], "default")) {
      insertColumns = [];
    }
  }

  return {
    table: chain.name,
    insertColumns,
    setColumns: setClauseColumns(tokens),
  };
}

const SET_CLAUSE_END = new Set(["from", "where", "returning"]);

/**
 * Every assignment target in every top-level SET clause: `a = 1`,
 * `(a, b) = (1, 2)`, `a[1] = 1`, and ON CONFLICT DO UPDATE SET.
 */
function setClauseColumns(tokens: AgentSqlToken[]): string[] {
  const columns: string[] = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (isOpening(token)) depth++;
    else if (isClosing(token)) depth--;
    if (depth !== 0 || !isWord(token, "set")) continue;

    let assignmentDepth = 0;
    let inTarget = true;
    for (index++; index < tokens.length; index++) {
      const inner = tokens[index];
      if (isOpening(inner)) assignmentDepth++;
      else if (isClosing(inner)) assignmentDepth--;
      if (assignmentDepth === 0) {
        if (
          inner.kind === "word" &&
          SET_CLAUSE_END.has(inner.value) &&
          !isWord(tokens[index - 1], "distinct")
        ) {
          break;
        }
        if (isPunctuation(inner, ",")) {
          inTarget = true;
          continue;
        }
        if (inner.kind === "operator" && inner.text === "=") {
          inTarget = false;
          continue;
        }
      }
      if (inTarget && isName(inner)) columns.push(inner.value);
    }
    index--;
  }
  return columns;
}

function assertNoRawDbAccessControlWriteTokens(
  statement: AgentPostgresStatement,
  label: string | undefined,
): void {
  const target = writeTarget(statement);
  if (!target) {
    fail(
      prefixed(
        label,
        "could not identify the table this statement writes. Write one table by its bare name.",
      ),
    );
  }
  if (hasSensitiveToken(target.table, ACCESS_CONTROL_TABLE_TOKENS)) {
    fail(
      prefixed(
        label,
        `Sensitive identity/access-control table "${target.table}" is not writable through raw DB tools. Use a dedicated app action or implement the permission change in reviewed code.`,
      ),
    );
  }
  for (const column of [
    ...(target.insertColumns ?? []),
    ...target.setColumns,
  ]) {
    if (!hasSensitiveToken(column, ACCESS_CONTROL_COLUMN_TOKENS)) continue;
    fail(
      prefixed(
        label,
        `Sensitive identity/access-control column "${column}" is not writable through raw DB tools. Use a dedicated app action or implement the permission change in reviewed code.`,
      ),
    );
  }
}

export function assertNoRawDbAccessControlPatchTarget(
  table: string,
  column: string,
): void {
  const tableName = table.trim().toLowerCase();
  if (hasSensitiveToken(tableName, ACCESS_CONTROL_TABLE_TOKENS)) {
    fail(
      `Sensitive identity/access-control table "${tableName}" is not patchable through raw DB tools. Use a dedicated app action or implement the permission change in reviewed code.`,
    );
  }
  const columnName = column.trim().toLowerCase();
  if (hasSensitiveToken(columnName, ACCESS_CONTROL_COLUMN_TOKENS)) {
    fail(
      `Sensitive identity/access-control column "${columnName}" is not patchable through raw DB tools. Use a dedicated app action or implement the permission change in reviewed code.`,
    );
  }
}

const BLOCKED_WHERE_KEYWORDS = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "drop",
  "alter",
  "create",
  "truncate",
  "grant",
  "revoke",
  "copy",
  "call",
]);

/**
 * Validates db-patch's `--where`, which is spliced into a SELECT and an
 * UPDATE. Both full statements are read and verified again before they run.
 */
export function validateRawDbPatchWhere(where: string): void {
  // Stricter than the lexer needs: a condition never needs a ';' or a comment.
  if (where.includes(";")) fail("--where must not contain ';'");
  const statement = guarded(() => readAgentPostgresStatement(where));
  let previousEnd = 0;
  for (const gap of [
    ...statement.tokens.map((token) => {
      const text = where.slice(previousEnd, token.start);
      previousEnd = token.end;
      return text;
    }),
    where.slice(previousEnd),
  ]) {
    if (gap.includes("--")) fail('--where must not contain "--"');
    if (gap.includes("/*")) fail('--where must not contain "/*"');
  }
  for (const token of statement.tokens) {
    if (token.kind === "word" && BLOCKED_WHERE_KEYWORDS.has(token.value)) {
      fail(`--where must not contain "${token.value.toUpperCase()}"`);
    }
  }
}

/** Reads a statement db-patch built from its arguments. */
export function readRawDbPatchStatement(
  sql: string,
  keyword: "select" | "update",
): AgentPostgresStatement {
  const statement = guarded(() => readAgentPostgresStatement(sql));
  if (statement.keyword !== keyword) {
    fail("--where must be a single condition.");
  }
  guarded(() => assertAgentPostgresTokenPolicy(statement));
  assertNoSensitiveFrameworkTableTokens(statement.tokens, "patch");
  return statement;
}
