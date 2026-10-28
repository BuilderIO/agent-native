export const ANALYTICS_ANALYSIS_RESULT_RENDERER = "analytics.analysis-result";

export interface SingleNumericAnalysisResult {
  label: string;
  value: number;
  comparison?: {
    changeRatio: number;
    period: string;
    previousValue: number;
  };
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

  const row = rows[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;

  const values = row as Record<string, unknown>;
  if (schema.length === 1) {
    const column = schema[0];
    if (!column || typeof column.name !== "string") return null;
    const value = values[column.name];
    return typeof value === "number" && Number.isFinite(value)
      ? { label: column.name, value }
      : null;
  }

  if (
    !schema.every(
      (column) =>
        column && typeof column === "object" && typeof column.name === "string",
    )
  ) {
    return null;
  }

  const names = schema.map((column) => column.name);
  if (
    schema.length !== 4 ||
    !["metric", "current_value", "previous_value", "period"].every((name) =>
      names.includes(name),
    )
  ) {
    return null;
  }

  const label = values.metric;
  const value = values.current_value;
  const previousValue = values.previous_value;
  const period = values.period;
  if (
    typeof label !== "string" ||
    !label.trim() ||
    label.length > 80 ||
    /[\r\n\u0000-\u001f]/.test(label) ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    typeof previousValue !== "number" ||
    !Number.isFinite(previousValue) ||
    previousValue <= 0 ||
    typeof period !== "string" ||
    !period.trim() ||
    period.length > 80 ||
    /[\r\n\u0000-\u001f]/.test(period)
  ) {
    return null;
  }

  const changeRatio = (value - previousValue) / previousValue;
  return Number.isFinite(changeRatio)
    ? {
        label: label.trim(),
        value,
        comparison: { changeRatio, period: period.trim(), previousValue },
      }
    : null;
}
