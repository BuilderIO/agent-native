export const PANEL_DRILLDOWN_MAX_SQL_LENGTH = 50_000;

export interface PanelDrilldown {
  sql: string;
}

export function isValidPanelDrilldown(value: unknown): value is PanelDrilldown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    typeof record.sql === "string" &&
    record.sql.trim().length > 0 &&
    record.sql.length <= PANEL_DRILLDOWN_MAX_SQL_LENGTH
  );
}

/**
 * Why `sql` can't run as a record template, or null. Agent saves check it as
 * well as clicks, because a failed click only shows "Couldn't load records".
 */
export function panelDrilldownSqlProblem(sql: string): string | null {
  if (/\{\{\?\w+\}\}/.test(sql)) {
    return "Record templates must not use conditional blocks. Use SQL CASE expressions with ordinary template variables";
  }
  const list = /\{\{(\w+):list\}\}/.exec(sql);
  if (list) {
    const value = `'{{${list[1]}}}'`;
    return (
      `Record templates must not use list variables such as {{${list[1]}:list}}. ` +
      "With nothing selected it renders as __empty_list_filter__, which the database rejects even in a CASE branch that never runs. " +
      `Match the comma-joined ${value} instead, treating '' and 'all' as every value. ` +
      `In BigQuery: (${value} IN ('', 'all') OR <column> IN UNNEST(SPLIT(${value}, ','))). ` +
      `In first-party SQL: (${value} IN ('', 'all') OR STRPOS(',' || ${value} || ',', ',' || <column> || ',') > 0)`
    );
  }
  return null;
}
