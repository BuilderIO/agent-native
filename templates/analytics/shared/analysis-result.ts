export const ANALYTICS_ANALYSIS_RESULT_RENDERER = "analytics.analysis-result";

export interface SingleNumericAnalysisResult {
  label: string;
  value: number;
}

export function getSingleNumericAnalysisResult(
  result: unknown,
): SingleNumericAnalysisResult | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }

  const record = result as Record<string, unknown>;
  if (record.truncated === true) return null;
  const rows = record.rows;
  const schema = record.schema;
  if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(schema)) {
    return null;
  }

  const column = schema[0];
  const row = rows[0];
  if (
    schema.length !== 1 ||
    !column ||
    typeof column !== "object" ||
    typeof column.name !== "string" ||
    !row ||
    typeof row !== "object" ||
    Array.isArray(row)
  ) {
    return null;
  }

  const value = (row as Record<string, unknown>)[column.name];
  return typeof value === "number" && Number.isFinite(value)
    ? { label: column.name, value }
    : null;
}
