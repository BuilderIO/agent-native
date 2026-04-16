/**
 * SQL template interpolation for dashboard panels.
 *
 * Two forms:
 *   {{name}}                       — replaced with vars[name], single quotes escaped
 *   {{?name}}...{{/name}}          — entire block emitted only when vars[name] is truthy
 *
 * Quote escaping doubles single quotes (' -> ''), which is standard SQL and works on
 * both BigQuery and SQLite/Postgres. Missing variables interpolate to empty string so
 * optional filters don't break SQL — wrap optional clauses in {{?name}}...{{/name}}.
 */

function escapeSqlValue(value: string): string {
  return value.replace(/'/g, "''");
}

export function interpolate(
  sql: string | undefined | null,
  vars: Record<string, string> = {},
): string {
  // Defensive: a malformed dashboard config (e.g. agent wrote a panel without
  // a `sql` field) should not crash the page. Treat missing/non-string SQL
  // as empty so the panel renders an empty result instead of throwing.
  if (typeof sql !== "string") return "";

  // Strip conditional blocks first so the inner {{name}} tokens are also processed
  // (or removed) in a single pass.
  const conditionalRe = /\{\{\?(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  const withConditionals = sql.replace(conditionalRe, (_match, name, body) => {
    const value = vars[name];
    return value && value.length > 0 ? body : "";
  });

  return withConditionals.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    const value = vars[name];
    if (value == null) return "";
    return escapeSqlValue(String(value));
  });
}
