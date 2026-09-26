
function escapeSqlValue(value: string): string {
  return value.replace(/'/g, "''");
}

export interface InterpolateOptions {
  failClosedTimeVariables?: boolean;
}

function isTimeVariable(name: string): boolean {
  return name === "timeRange" || /(?:Start|End)$/.test(name);
}

export function interpolate(
  sql: string | undefined | null,
  vars: Record<string, string> = {},
  options: InterpolateOptions = {},
): string {
  if (typeof sql !== "string") return "";

  const conditionalRe = /\{\{\?(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  const withConditionals = sql.replace(conditionalRe, (_match, name, body) => {
    const value = vars[name];
    return value && value.length > 0 ? body : "";
  });

  return withConditionals.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    const value = vars[name];
    if (
      options.failClosedTimeVariables &&
      isTimeVariable(name) &&
      (value == null || value.length === 0)
    ) {
      return "__missing_dashboard_time_filter__";
    }
    if (value == null) return "";
    return escapeSqlValue(String(value));
  });
}
