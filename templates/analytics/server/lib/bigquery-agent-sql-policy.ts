import {
  AgentSqlSyntaxError,
  leadingAgentSqlKeyword,
  lexAgentSql,
  readAgentSqlQuery,
  splitAgentSqlStatements,
  type AgentSqlToken,
} from "@agent-native/core/agent-sql";

export const BIGQUERY_AGENT_SQL_POLICY_VERSION = "2026-11-22.2";

export const BIGQUERY_AGENT_DATASET_ALLOWLIST: Readonly<
  Partial<Record<string, readonly string[]>>
> = Object.freeze({
  "builder-3b0a2": Object.freeze([
    "amplitude",
    "dbt_analytics",
    "dbt_mart",
    "dbt_staging_bigquery",
    "dbt_staging_firestore",
    "finance",
    "hubspot",
    "metrics",
    "sigma_materialized",
  ]),
});

export const BIGQUERY_AGENT_REVIEWED_VIEWS: ReadonlySet<string> = new Set();

const SQL_MAX_CHARS = 100_000;

const BUILTIN_FUNCTION_NAMESPACES = new Set([
  "safe",
  "net",
  "hll_count",
  "kll_quantiles",
]);

const DENIED_FUNCTIONS = new Set([
  "external_query",
  "appends",
  "changes",
  "vector_search",
]);

const DENIED_NAMESPACES = new Set(["obj", "keys", "aead"]);

const DENIED_WORDS = new Set(["information_schema", "_table_suffix"]);

export type BigQueryAgentSqlRefusalCode =
  | "query_statement_not_allowed"
  | "query_feature_not_allowed"
  | "query_table_not_allowed";

export class BigQueryAgentSqlRefusal extends Error {
  readonly code: BigQueryAgentSqlRefusalCode;
  constructor(code: BigQueryAgentSqlRefusalCode, message: string) {
    super(message);
    this.name = "BigQueryAgentSqlRefusal";
    this.code = code;
  }
}

function feature(message: string): never {
  throw new BigQueryAgentSqlRefusal(
    "query_feature_not_allowed",
    `${message} Outside agents can run one read-only SELECT over allowlisted tables; rewrite the query without it.`,
  );
}

function table(message: string): never {
  throw new BigQueryAgentSqlRefusal("query_table_not_allowed", message);
}

function statement(message: string): never {
  throw new BigQueryAgentSqlRefusal(
    "query_statement_not_allowed",
    `${message} Outside agents can run exactly one read-only SELECT; scripts, DML, DDL and multiple statements are refused.`,
  );
}

function requireOneSelect(tokens: AgentSqlToken[]): void {
  const statements = splitAgentSqlStatements(tokens);
  if (statements.length !== 1) {
    statement(
      statements.length === 0
        ? "The SQL is empty."
        : `The SQL has ${statements.length} statements.`,
    );
  }
  const keyword = leadingAgentSqlKeyword(statements[0] ?? []);
  if (keyword !== "select" && keyword !== "with") {
    statement(
      `The SQL starts with ${keyword ? keyword.toUpperCase() : "something other than a keyword"}, not SELECT or WITH.`,
    );
  }
}

export interface BigQueryAgentTableRef {
  projectId: string;
  datasetId: string;
  tableId: string;
}

export function bigQueryTableKey(ref: BigQueryAgentTableRef): string {
  return `${ref.projectId.toLowerCase()}.${ref.datasetId}.${ref.tableId}`;
}

export interface CheckedBigQueryAgentSql {
  sql: string;
  tables: BigQueryAgentTableRef[];
}

function tokenAt(
  tokens: readonly AgentSqlToken[],
  index: number,
): AgentSqlToken | undefined {
  return tokens[index];
}

function isName(token: AgentSqlToken | undefined): token is AgentSqlToken {
  return token?.kind === "word" || token?.kind === "quoted-identifier";
}

function resolveProjectPlaceholder(
  sql: string,
  tokens: readonly AgentSqlToken[],
  projectId: string,
): string {
  let resolved = "";
  let cursor = 0;
  tokens.forEach((token, index) => {
    if (token.kind !== "parameter") return;
    const next = tokenAt(tokens, index + 1);
    if (
      token.text.toLowerCase() !== "@project" ||
      next?.kind !== "punctuation" ||
      next.text !== "."
    ) {
      feature("Query parameters and system variables are not allowed.");
    }
    // raw-sql-ok: replaces only the lexed `@project` token with the connection's quoted project ID; the SQL is the agent's own SELECT, checked after this.
    resolved += `${sql.slice(cursor, token.start)}\`${projectId}\``;
    cursor = token.end;
  });
  // raw-sql-ok: the rest of the agent's SQL, unchanged.
  return resolved + sql.slice(cursor);
}

function denyFeatures(tokens: readonly AgentSqlToken[]): void {
  tokens.forEach((token, index) => {
    if (!isName(token)) return;
    const parts = token.value.toLowerCase().split(".");
    for (const part of parts) {
      if (DENIED_WORDS.has(part)) {
        feature(
          part === "information_schema"
            ? "INFORMATION_SCHEMA is not allowed."
            : "Wildcard tables (_TABLE_SUFFIX) are not allowed.",
        );
      }
    }
    const next = tokenAt(tokens, index + 1);
    if (next?.kind !== "punctuation" || next.text !== "(") return;
    const name = parts.pop() ?? "";
    if (DENIED_FUNCTIONS.has(name)) {
      feature(`${name.toUpperCase()} is not allowed.`);
    }
    const qualifiers = parts;
    for (let back = index - 1; ; back -= 2) {
      const dot = tokenAt(tokens, back);
      const qualifier = tokenAt(tokens, back - 1);
      if (dot?.kind !== "punctuation" || dot.text !== "." || !isName(qualifier))
        break;
      qualifiers.unshift(...qualifier.value.toLowerCase().split("."));
    }
    const [namespace = ""] = qualifiers;
    if (!namespace) return;
    if (namespace === "ml" || namespace === "ai") {
      feature(`${namespace.toUpperCase()}.* functions are not allowed.`);
    }
    if (DENIED_NAMESPACES.has(namespace)) {
      feature("OBJ.*, KEYS.* and AEAD.* functions are not allowed.");
    }
    if (qualifiers.length > 1 || !BUILTIN_FUNCTION_NAMESPACES.has(namespace)) {
      feature(
        "Persistent, remote, and other user-defined functions are not allowed.",
      );
    }
  });
}

export function checkBigQueryAgentSql(
  sql: string,
  connectionProjectId: string,
): CheckedBigQueryAgentSql {
  if (sql.length > SQL_MAX_CHARS) {
    feature(
      `SQL longer than ${SQL_MAX_CHARS.toLocaleString("en-US")} characters is not allowed.`,
    );
  }
  if (!BIGQUERY_AGENT_DATASET_ALLOWLIST[connectionProjectId.toLowerCase()]) {
    table(
      "This Analytics BigQuery connection has no datasets approved for outside agents, so no table can be read. Ask in the Analytics app instead.",
    );
  }
  let resolved: string;
  let query: ReturnType<typeof readAgentSqlQuery>;
  try {
    const tokens = lexAgentSql(sql, { dialect: "bigquery" });
    requireOneSelect(tokens);
    // raw-sql-ok: the agent's SQL with only `@project` resolved; the grammar, feature, table and dry-run checks below run on exactly this text.
    resolved = resolveProjectPlaceholder(sql, tokens, connectionProjectId);
    query = readAgentSqlQuery(resolved, { dialect: "bigquery" });
  } catch (error) {
    if (error instanceof BigQueryAgentSqlRefusal) throw error;
    if (error instanceof AgentSqlSyntaxError) feature(error.message);
    throw error;
  }
  denyFeatures(query.tokens);
  const tables = new Map<string, BigQueryAgentTableRef>();
  for (const source of query.sources) {
    if (source.cte) continue;
    const parts = [...source.qualifiers, source.name];
    if (parts.length !== 3) {
      table(
        `Table \`${parts.join(".")}\` must be fully qualified as \`project.dataset.table\` (use @project for this connection's project).`,
      );
    }
    const [projectId, datasetId, tableId] = parts as [string, string, string];
    const allowed = BIGQUERY_AGENT_DATASET_ALLOWLIST[projectId.toLowerCase()];
    if (!allowed?.includes(datasetId)) {
      table(
        `Table \`${parts.join(".")}\` is outside the datasets approved for outside agents (${Object.entries(
          BIGQUERY_AGENT_DATASET_ALLOWLIST,
        )
          .map(
            ([project, datasets]) =>
              `${project}: ${(datasets ?? []).join(", ")}`,
          )
          .join("; ")}).`,
      );
    }
    const ref = { projectId: projectId.toLowerCase(), datasetId, tableId };
    tables.set(bigQueryTableKey(ref), ref);
  }
  return { sql: resolved, tables: [...tables.values()] };
}

export interface BigQueryAgentTableResource {
  type?: string;
  externalDataConfiguration?: unknown;
  biglakeConfiguration?: unknown;
  cloneDefinition?: unknown;
  snapshotDefinition?: unknown;
}

export function checkBigQueryAgentTableKind(
  ref: BigQueryAgentTableRef,
  resource: BigQueryAgentTableResource,
): void {
  const name = bigQueryTableKey(ref);
  const { type } = resource;
  if (resource.biglakeConfiguration !== undefined) {
    feature(
      `\`${name}\` is a BigLake table whose data lives outside BigQuery storage, which is not allowed.`,
    );
  }
  if (resource.externalDataConfiguration !== undefined) {
    feature(
      `\`${name}\` reads data stored outside BigQuery (an external table), which is not allowed.`,
    );
  }
  if (type === "TABLE" || type === "SNAPSHOT") return;
  if (
    (type === "VIEW" || type === "MATERIALIZED_VIEW") &&
    BIGQUERY_AGENT_REVIEWED_VIEWS.has(name)
  ) {
    return;
  }
  if (type === "EXTERNAL")
    feature(`\`${name}\` is an external table, which is not allowed.`);
  if (type === "VIEW" || type === "MATERIALIZED_VIEW") {
    table(
      `\`${name}\` is a view that has not been reviewed for outside agents. Query its underlying tables instead.`,
    );
  }
  table(
    `\`${name}\` could not be confirmed as a table (type ${type ?? "unknown"}).`,
  );
}

export function crossCheckBigQueryAgentDryRun(
  checked: CheckedBigQueryAgentSql,
  dryRun: {
    statementType?: string;
    referencedTables?: readonly BigQueryAgentTableRef[] | "malformed";
    referencedRoutines?: readonly unknown[] | "malformed";
  },
): void {
  if (dryRun.statementType !== "SELECT") {
    statement(
      `BigQuery reads this as ${dryRun.statementType ? `a ${dryRun.statementType} statement` : "an unknown statement type"}, not one SELECT.`,
    );
  }
  if (dryRun.referencedRoutines === "malformed") {
    feature("BigQuery's list of routines this query calls could not be read.");
  }
  if (dryRun.referencedRoutines?.length) {
    feature(
      "BigQuery says this query calls a persistent, remote or table-valued function.",
    );
  }
  if (dryRun.referencedTables === "malformed") {
    table(
      "BigQuery's list of tables this query reads could not be read, so it was not run.",
    );
  }
  for (const ref of dryRun.referencedTables ?? []) {
    if (
      !BIGQUERY_AGENT_DATASET_ALLOWLIST[ref.projectId.toLowerCase()]?.includes(
        ref.datasetId,
      )
    ) {
      table(
        `BigQuery says this query reads \`${bigQueryTableKey(ref)}\`, outside the datasets approved for outside agents. It was not run.`,
      );
    }
  }
  const named = new Set(checked.tables.map(bigQueryTableKey));
  const read = new Set((dryRun.referencedTables ?? []).map(bigQueryTableKey));
  for (const key of read) {
    if (!named.has(key)) {
      table(
        `BigQuery says this query also reads \`${key}\`, which the SQL does not name (a view or routine). It was not run.`,
      );
    }
  }
  for (const key of named) {
    if (!read.has(key)) {
      table(
        `BigQuery does not list \`${key}\` among the tables this query reads, so it may be a view. It was not run.`,
      );
    }
  }
}
