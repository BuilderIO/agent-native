import {
  AgentSqlSyntaxError,
  lexAgentSql,
  readAgentSqlQuery,
  type AgentSqlToken,
} from "@agent-native/core/agent-sql";

/**
 * What arbitrary SQL from an outside agent may read in BigQuery. A positive
 * grammar (one SELECT query, `readAgentSqlQuery`) narrowed by a feature
 * denylist, fully qualified tables only, and a static dataset allowlist per
 * project. The dry run is a cross-check, never the only check.
 */
export const BIGQUERY_AGENT_SQL_POLICY_VERSION = "2026-11-17.1";

/**
 * Datasets an outside agent may read, keyed by BigQuery project. These are the
 * datasets the Analytics data dictionary's human-approved entries document.
 * Every other project, and every connection whose project is not a key here,
 * is deny-all. Reviewed in code, not configured at runtime.
 */
export const BIGQUERY_AGENT_DATASET_ALLOWLIST: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  "builder-3b0a2": Object.freeze([
    "amplitude",
    "billing_export",
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

/**
 * Views an outside agent may read, as `project.dataset.view`. A view can read
 * tables outside the allowlist, so each one is reviewed before it is listed.
 */
export const BIGQUERY_AGENT_REVIEWED_VIEWS: ReadonlySet<string> = new Set();

const SQL_MAX_CHARS = 100_000;

/** Namespaced built-in functions. Any other qualified call is a UDF, remote function, ML.* or AI.*. */
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

const DENIED_WORDS = new Set(["information_schema", "_table_suffix"]);

export type BigQueryAgentSqlRefusalCode =
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

export interface BigQueryAgentTableRef {
  projectId: string;
  datasetId: string;
  tableId: string;
}

export function bigQueryTableKey(ref: BigQueryAgentTableRef): string {
  return `${ref.projectId.toLowerCase()}.${ref.datasetId}.${ref.tableId}`;
}

export interface CheckedBigQueryAgentSql {
  /** The SQL BigQuery runs: `@project` resolved, nothing else rewritten. */
  sql: string;
  tables: BigQueryAgentTableRef[];
}

/** `@project.` names the connection's project; any other parameter or system variable is refused. */
function resolveProjectPlaceholder(
  sql: string,
  tokens: AgentSqlToken[],
  projectId: string,
): string {
  let resolved = "";
  let cursor = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== "parameter") continue;
    const next = tokens[index + 1];
    if (
      token.text.toLowerCase() !== "@project" ||
      next?.kind !== "punctuation" ||
      next.text !== "."
    ) {
      feature("Query parameters and system variables are not allowed.");
    }
    resolved += `${sql.slice(cursor, token.start)}\`${projectId}\``;
    cursor = token.end;
  }
  return resolved + sql.slice(cursor);
}

function denyFeatures(tokens: AgentSqlToken[]): void {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== "word" && token.kind !== "quoted-identifier") continue;
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
    const next = tokens[index + 1];
    if (next?.kind !== "punctuation" || next.text !== "(") continue;
    const name = parts[parts.length - 1];
    if (DENIED_FUNCTIONS.has(name)) {
      feature(`${name.toUpperCase()} is not allowed.`);
    }
    const qualifiers: string[] = parts.slice(0, -1);
    for (
      let back = index - 1;
      back > 0 &&
      tokens[back].kind === "punctuation" &&
      tokens[back].text === "." &&
      (tokens[back - 1].kind === "word" ||
        tokens[back - 1].kind === "quoted-identifier");
      back -= 2
    ) {
      qualifiers.unshift(...tokens[back - 1].value.toLowerCase().split("."));
    }
    if (qualifiers.length === 0) continue;
    if (qualifiers[0] === "ml" || qualifiers[0] === "ai") {
      feature(`${qualifiers[0].toUpperCase()}.* functions are not allowed.`);
    }
    if (
      qualifiers.length > 1 ||
      !BUILTIN_FUNCTION_NAMESPACES.has(qualifiers[0])
    ) {
      feature(
        "Persistent, remote, and other user-defined functions are not allowed.",
      );
    }
  }
}

/**
 * Static checks before anything reaches BigQuery: exactly one SELECT in the
 * bounded grammar, no denied feature, every table `project.dataset.table` in
 * an allowlisted dataset. Throws {@link BigQueryAgentSqlRefusal}.
 */
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
    resolved = resolveProjectPlaceholder(
      sql,
      lexAgentSql(sql, { dialect: "bigquery" }),
      connectionProjectId,
    );
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
          .map(([project, datasets]) => `${project}: ${datasets.join(", ")}`)
          .join("; ")}).`,
      );
    }
    const ref = { projectId: projectId.toLowerCase(), datasetId, tableId };
    tables.set(bigQueryTableKey(ref), ref);
  }
  return { sql: resolved, tables: [...tables.values()] };
}

/** Kinds of BigQuery table an outside agent may read; views need review, external tables never. */
export function checkBigQueryAgentTableKind(
  ref: BigQueryAgentTableRef,
  type: string | undefined,
): void {
  if (type === "TABLE" || type === "SNAPSHOT") return;
  const name = bigQueryTableKey(ref);
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

/**
 * The dry run must agree with the static read: exactly one SELECT, reading
 * exactly the tables the SQL names. A table it reads that the SQL does not
 * name came through a view or routine, which is refused.
 */
export function crossCheckBigQueryAgentDryRun(
  checked: CheckedBigQueryAgentSql,
  dryRun: {
    statementType?: string;
    referencedTables?: readonly BigQueryAgentTableRef[] | "malformed";
  },
): void {
  if (dryRun.statementType !== "SELECT") {
    feature(
      `BigQuery reads this as ${dryRun.statementType ? `a ${dryRun.statementType} statement` : "an unknown statement type"}, not one SELECT.`,
    );
  }
  if (dryRun.referencedTables === "malformed") {
    table(
      "BigQuery's list of tables this query reads could not be read, so it was not run.",
    );
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
