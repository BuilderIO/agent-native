export type DatabaseToolsOption = boolean | "read" | "write" | "off";

export type DatabaseToolsMode = "off" | "read" | "write";

export function normalizeDatabaseToolsMode(
  value: DatabaseToolsOption | undefined,
): DatabaseToolsMode {
  if (value === false || value === "off") return "off";
  if (value === true || value === "write") return "write";
  return "read";
}

export function hasDatabaseReadTools(
  value: DatabaseToolsOption | undefined,
): boolean {
  return normalizeDatabaseToolsMode(value) !== "off";
}

export function hasDatabaseWriteTools(
  value: DatabaseToolsOption | undefined,
): boolean {
  return normalizeDatabaseToolsMode(value) === "write";
}
