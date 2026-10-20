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
