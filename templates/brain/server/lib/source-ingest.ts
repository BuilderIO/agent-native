import { parseJson } from "./brain.js";

export function sourceKeyFor(source: {
  sourceKey?: string | null;
  configJson?: string | null;
}) {
  const columnValue = source.sourceKey?.trim();
  if (columnValue) return columnValue;
  const config = parseJson<Record<string, unknown> | null>(
    source.configJson,
    {},
  );
  const configValue = config?.sourceKey;
  return typeof configValue === "string" && configValue.trim()
    ? configValue.trim()
    : null;
}
