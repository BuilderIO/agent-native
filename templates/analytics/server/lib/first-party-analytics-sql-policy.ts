import type { AgentSqlQuery } from "@agent-native/core/agent-sql";

const POSTGRES_SET_RETURNING_FUNCTIONS = new Set([
  "generate_series",
  "generate_subscripts",
  "json_array_elements",
  "json_array_elements_text",
  "json_each",
  "json_each_text",
  "json_object_keys",
  "json_populate_recordset",
  "json_to_recordset",
  "jsonb_array_elements",
  "jsonb_array_elements_text",
  "jsonb_each",
  "jsonb_each_text",
  "jsonb_object_keys",
  "jsonb_path_query",
  "jsonb_populate_recordset",
  "jsonb_to_recordset",
  "regexp_matches",
  "regexp_split_to_table",
  "string_to_table",
  "unnest",
]);
const SAFE_ANALYTICS_SQL_FUNCTIONS = new Set([
  "chr",
  "coalesce",
  "count",
  "date_trunc",
  "first_value",
  "floor",
  "greatest",
  "least",
  "lower",
  "max",
  "min",
  "nullif",
  "round",
  "row_number",
  "split_part",
  "string_to_array",
  "substr",
  "sum",
  "to_char",
  "trim",
  "upper",
]);
const SQL_PARENTHESIS_KEYWORDS = new Set([
  "all",
  "and",
  "any",
  "as",
  "by",
  "cast",
  "distinct",
  "else",
  "exists",
  "extract",
  "filter",
  "from",
  "group",
  "having",
  "in",
  "join",
  "not",
  "on",
  "order",
  "or",
  "over",
  "select",
  "some",
  "then",
  "using",
  "values",
  "where",
]);
const SAFE_BIGQUERY_FUNCTIONS = new Set([
  "abs",
  "approx_count_distinct",
  "approx_quantiles",
  "array",
  "array_agg",
  "array_concat",
  "array_concat_agg",
  "array_length",
  "array_to_string",
  "avg",
  "byte_length",
  "ceil",
  "ceiling",
  "char_length",
  "chr",
  "coalesce",
  "concat",
  "contains_substr",
  "count",
  "countif",
  "cume_dist",
  "current_date",
  "current_datetime",
  "current_time",
  "current_timestamp",
  "date",
  "date_add",
  "date_diff",
  "date_sub",
  "date_trunc",
  "datetime",
  "datetime_add",
  "datetime_diff",
  "datetime_sub",
  "datetime_trunc",
  "dense_rank",
  "ends_with",
  "first_value",
  "floor",
  "format",
  "format_date",
  "format_datetime",
  "format_time",
  "format_timestamp",
  "generate_array",
  "generate_date_array",
  "generate_timestamp_array",
  "greatest",
  "if",
  "ifnull",
  "json_extract",
  "json_extract_array",
  "json_extract_scalar",
  "json_query",
  "json_query_array",
  "json_value",
  "json_value_array",
  "lag",
  "last_value",
  "lead",
  "least",
  "length",
  "lower",
  "lpad",
  "ltrim",
  "max",
  "min",
  "mod",
  "nth_value",
  "nullif",
  "offset",
  "ordinal",
  "parse_date",
  "parse_datetime",
  "parse_time",
  "parse_timestamp",
  "percent_rank",
  "rank",
  "regexp_contains",
  "regexp_extract",
  "regexp_extract_all",
  "regexp_replace",
  "replace",
  "round",
  "row_number",
  "rpad",
  "rtrim",
  "safe_cast",
  "safe_divide",
  "safe_multiply",
  "safe_negate",
  "safe_offset",
  "safe_ordinal",
  "safe_subtract",
  "sign",
  "split",
  "starts_with",
  "string",
  "string_agg",
  "strpos",
  "struct",
  "substr",
  "substring",
  "sum",
  "time",
  "time_add",
  "time_diff",
  "time_sub",
  "time_trunc",
  "timestamp",
  "timestamp_add",
  "timestamp_diff",
  "timestamp_micros",
  "timestamp_millis",
  "timestamp_seconds",
  "timestamp_sub",
  "timestamp_trunc",
  "to_json",
  "to_json_string",
  "trim",
  "unix_date",
  "unix_micros",
  "unix_millis",
  "unix_seconds",
  "upper",
]);

export function validateAnalyticsSqlFunctions(
  query: AgentSqlQuery,
  dialect: "postgres" | "bigquery" = "postgres",
): void {
  const { tokens } = query;
  const declarations = new Set(query.ctes.map((cte) => cte.start));
  for (let i = 0; i + 1 < tokens.length; i++) {
    const token = tokens[i];
    if (tokens[i + 1].text !== "(") continue;
    if (token.kind !== "word" && token.kind !== "quoted-identifier") continue;
    if (declarations.has(token.start)) continue;
    const quoted = token.kind === "quoted-identifier";
    const name = token.value.toLowerCase();
    if (
      !quoted &&
      (SQL_PARENTHESIS_KEYWORDS.has(name) ||
        (dialect === "bigquery" && name === "week")) &&
      tokens[i - 1]?.text !== "."
    )
      continue;
    if (dialect === "postgres" && POSTGRES_SET_RETURNING_FUNCTIONS.has(name)) {
      throw new Error(
        `First-party analytics queries cannot call set-returning function ${token.value}`,
      );
    }
    const schemaQualified = tokens[i - 1]?.text === ".";
    const schema = schemaQualified ? tokens[i - 2] : undefined;
    const allowedSchema =
      !schemaQualified ||
      (schema?.kind === "word" &&
        schema.value === (dialect === "postgres" ? "pg_catalog" : "safe") &&
        tokens[i - 3]?.text !== ".");
    const allowedFunction =
      (dialect === "postgres"
        ? SAFE_ANALYTICS_SQL_FUNCTIONS
        : SAFE_BIGQUERY_FUNCTIONS
      ).has(name) ||
      (dialect === "bigquery" &&
        query.dialect === "postgres" &&
        (SAFE_ANALYTICS_SQL_FUNCTIONS.has(name) || name === "now"));
    if (
      (dialect === "postgres" && quoted && token.value !== name) ||
      !allowedFunction ||
      !allowedSchema
    ) {
      throw new Error(
        `First-party analytics queries cannot call unapproved SQL function ${token.value}`,
      );
    }
  }
}
