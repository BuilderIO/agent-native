import {
  agentSqlIdentifierNames,
  agentSqlQualifiedReferences,
  leadingAgentSqlKeyword,
  splitAgentSqlStatements,
} from "./analysis.js";
import {
  AgentSqlSyntaxError,
  lexAgentSql,
  type AgentSqlToken,
} from "./lexer.js";

export type AgentSqlPolicyErrorCode =
  | "unreadable"
  | "empty"
  | "multiple_statements"
  | "refused";

/**
 * Agent SQL was refused by policy. The message is written for the agent: it
 * says what was refused and what to do instead. `code` lets a caller word the
 * structural cases in its own terms.
 */
export class AgentSqlPolicyError extends Error {
  readonly code: AgentSqlPolicyErrorCode;

  constructor(message: string, code: AgentSqlPolicyErrorCode = "refused") {
    super(message);
    this.name = "AgentSqlPolicyError";
    this.code = code;
  }
}

function refuse(
  message: string,
  code: AgentSqlPolicyErrorCode = "refused",
): never {
  throw new AgentSqlPolicyError(message, code);
}

export interface AgentPostgresStatement {
  /**
   * The statement text from its first token to its last, so a trailing
   * semicolon or comment is gone and appended text cannot be swallowed.
   */
  sql: string;
  tokens: AgentSqlToken[];
  /** Lower-case leading keyword, ignoring leading parentheses. */
  keyword: string | null;
}

/**
 * Reads exactly one Postgres statement the way the database will. Throws
 * {@link AgentSqlPolicyError} for text the lexer cannot read, an empty input,
 * or more than one statement.
 */
export function readAgentPostgresStatement(
  sql: string,
): AgentPostgresStatement {
  let tokens: AgentSqlToken[];
  try {
    tokens = lexAgentSql(sql, { dialect: "postgres" });
  } catch (error) {
    if (error instanceof AgentSqlSyntaxError) {
      refuse(
        `The SQL could not be read safely: ${error.message}`,
        "unreadable",
      );
    }
    throw error;
  }
  const statements = splitAgentSqlStatements(tokens);
  if (statements.length === 0) refuse("The SQL is empty.", "empty");
  if (statements.length > 1) {
    refuse(
      "The SQL contains more than one statement. Send one statement at a time.",
      "multiple_statements",
    );
  }
  const [statementTokens] = statements;
  return {
    sql: sql.slice(
      statementTokens[0].start,
      statementTokens[statementTokens.length - 1].end,
    ),
    tokens: statementTokens,
    keyword: leadingAgentSqlKeyword(statementTokens),
  };
}

// Postgres truncates longer identifiers to this many bytes, so a longer name
// could resolve to an object whose name does not match it textually.
const MAX_IDENTIFIER_BYTES = 63;

// Schemas that hold base tables or catalogs. A name qualified with one of them
// skips the per-user views, which only shadow unqualified names. The
// in-transaction check below also catches every other schema in the database.
// `main` is SQLite's schema name, kept so ported SQL gets the same answer.
const KNOWN_SCHEMA_RE =
  /^(?:public|main|pg_catalog|information_schema|pg_toast|pg_temp|pg_temp_\d+|pg_toast_temp_\d+)$/i;

// Built-in functions that run SQL text, read or change server or session
// state, or reach outside the database. Matched against every identifier, not
// only called names, because Postgres also resolves `row.fn` as `fn(row)`.
const DENIED_IDENTIFIER_RES = [
  // Catalog functions and relations. A short allowlist below keeps the
  // harmless type and size helpers usable.
  /^pg_/i,
  // Large-object functions read and write server-side files and objects.
  /^lo_/i,
  // dblink opens a new connection that runs arbitrary SQL.
  /^dblink/i,
  // query_to_xml, table_to_xml, schema_to_xml, ... run or dump SQL by name.
  /_to_xml/i,
  /^(?:set_config|current_setting|setval)$/i,
];
const ALLOWED_PG_IDENTIFIERS = new Set([
  "pg_typeof",
  "pg_column_size",
  "pg_size_pretty",
]);

/**
 * Checks that need only the statement's tokens. Run them on every statement
 * before it reaches the database, and again on the final executed text.
 */
export function assertAgentPostgresTokenPolicy(
  statement: AgentPostgresStatement,
): void {
  for (const token of statement.tokens) {
    if (token.kind !== "word" && token.kind !== "quoted-identifier") continue;
    if (Buffer.byteLength(token.value, "utf8") > MAX_IDENTIFIER_BYTES) {
      refuse(
        `Identifier "${token.value.slice(0, 20)}…" is longer than ${MAX_IDENTIFIER_BYTES} bytes.`,
      );
    }
    const value = token.value.toLowerCase();
    if (ALLOWED_PG_IDENTIFIERS.has(value)) continue;
    if (DENIED_IDENTIFIER_RES.some((re) => re.test(value))) {
      refuse(
        `"${token.value}" is not available in agent SQL. Query the app's tables by their bare names.`,
      );
    }
  }

  for (const reference of agentSqlQualifiedReferences(statement.tokens)) {
    if (reference.qualifiers.length > 1) {
      refuse(
        `"${[...reference.qualifiers, reference.name].join(".")}" names a database or schema. Use bare table names; the current user's scoping is applied automatically.`,
      );
    }
    if (KNOWN_SCHEMA_RE.test(reference.qualifiers[0])) {
      refuse(
        `Schema-qualified names such as "${reference.qualifiers[0]}.${reference.name}" bypass the per-user data scoping. Use the bare table name; the current user's scoping is applied automatically.`,
      );
    }
  }
}

export interface AgentSqlQueryRunner {
  unsafe(sql: string, args?: unknown[]): Promise<unknown[]>;
}

/**
 * Checks how the statement's names resolve in this transaction, after the
 * per-user temporary views exist. Run it immediately before the statement.
 *
 * - String literals must follow the standard rules the lexer assumes.
 * - No qualifier may name a schema or this database.
 * - Every name that resolves to a relation must resolve to one of this
 *   session's temporary views. That covers tables the views do not shadow,
 *   such as materialized views and sequences, and other schemas on the
 *   search path.
 * - No name may match a function or operator outside `pg_catalog` that is
 *   written in SQL or a procedural language, since its body can read tables
 *   without the views.
 */
export async function verifyAgentPostgresResolution(
  db: AgentSqlQueryRunner,
  statement: AgentPostgresStatement,
): Promise<void> {
  const [setting] = (await db.unsafe(
    "SELECT pg_catalog.current_setting('standard_conforming_strings') AS value",
  )) as Array<{ value?: string }>;
  if (setting?.value !== "on") {
    refuse(
      "Agent SQL requires standard_conforming_strings to be on for this database connection.",
    );
  }

  const names = [...agentSqlIdentifierNames(statement.tokens)];
  if (names.length === 0) return;

  const qualifiers = [
    ...new Set(
      agentSqlQualifiedReferences(statement.tokens).flatMap(
        (reference) => reference.qualifiers,
      ),
    ),
  ];
  if (qualifiers.length > 0) {
    const schemas = (await db.unsafe(
      `SELECT nspname AS name FROM pg_catalog.pg_namespace WHERE nspname = ANY($1::text[])
       UNION ALL
       SELECT pg_catalog.current_database() WHERE pg_catalog.current_database() = ANY($1::text[])`,
      [qualifiers],
    )) as Array<{ name: string }>;
    if (schemas.length > 0) {
      refuse(
        `"${schemas[0].name}" names a schema or database. Use bare table names; the current user's scoping is applied automatically.`,
      );
    }
  }

  const relations = (await db.unsafe(
    `SELECT n.name
       FROM pg_catalog.unnest($1::text[]) AS n(name)
       JOIN pg_catalog.pg_class c
         ON c.oid = pg_catalog.to_regclass(pg_catalog.quote_ident(n.name))
      WHERE c.relnamespace IS DISTINCT FROM pg_catalog.pg_my_temp_schema()`,
    [names],
  )) as Array<{ name: string }>;
  if (relations.length > 0) {
    refuse(
      `"${relations[0].name}" is not one of the app's tables scoped to the current user, so agent SQL cannot read or write it.`,
    );
  }

  const routines = (await db.unsafe(
    `SELECT p.proname AS name
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
       JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.proname = ANY($1::text[])
        AND ns.nspname <> 'pg_catalog'
        AND l.lanname NOT IN ('c', 'internal')
      LIMIT 1`,
    [names],
  )) as Array<{ name: string }>;
  if (routines.length > 0) {
    refuse(
      `"${routines[0].name}" matches an app-defined database function, which agent SQL cannot call.`,
    );
  }

  const operators = [
    ...new Set(
      statement.tokens
        .filter((token) => token.kind === "operator")
        .map((token) => token.text),
    ),
  ];
  if (operators.length > 0) {
    const appOperators = (await db.unsafe(
      `SELECT o.oprname AS name
         FROM pg_catalog.pg_operator o
         JOIN pg_catalog.pg_namespace ns ON ns.oid = o.oprnamespace
         JOIN pg_catalog.pg_proc p ON p.oid = o.oprcode
         JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        WHERE o.oprname = ANY($1::text[])
          AND ns.nspname <> 'pg_catalog'
          AND l.lanname NOT IN ('c', 'internal')
        LIMIT 1`,
      [operators],
    )) as Array<{ name: string }>;
    if (appOperators.length > 0) {
      refuse(
        `Operator "${appOperators[0].name}" is backed by an app-defined database function, which agent SQL cannot call.`,
      );
    }
  }
}
