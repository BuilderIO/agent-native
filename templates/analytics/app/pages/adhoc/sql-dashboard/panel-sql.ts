export function serializePanelSql(sql: unknown): string {
  if (typeof sql === "string") return sql;
  if (sql && typeof sql === "object" && !Array.isArray(sql)) {
    return JSON.stringify(sql);
  }
  return "";
}
