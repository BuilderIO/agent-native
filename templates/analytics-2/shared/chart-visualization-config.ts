import type { ChartSpec } from "../app/lib/model/contracts.js";
import type { ResultField } from "./notebook-result-contract.js";

export function defaultChartSpec(
  source: { cellId: string; exportId: string } | null,
): ChartSpec {
  return {
    version: 3,
    revision: 0,
    mark: "bar",
    stacked: true,
    ...(source
      ? { sourceCellId: source.cellId, sourceExportId: source.exportId }
      : {}),
    xField: null,
    xTimeUnit: "month",
    yField: null,
    seriesField: null,
    title: null,
  };
}

export function chartNeedsDefaultAxes(spec: ChartSpec) {
  return (
    spec.xField === null &&
    spec.yField === null &&
    spec.seriesField === null &&
    !spec.yFields?.length &&
    !spec.countRecords
  );
}

export function chartMeasureFieldIds(spec: ChartSpec) {
  if (spec.countRecords) return [null];
  return spec.yFields?.length && spec.mark !== "pie"
    ? spec.yFields
    : [spec.yField];
}

export function bindDefaultChartAxes(
  spec: ChartSpec,
  fields: readonly ResultField[],
): ChartSpec {
  if (!chartNeedsDefaultAxes(spec)) return spec;
  const temporal = fields.find(
    ({ type }) => type === "date" || type === "datetime",
  );
  const categorical = fields.find(
    ({ type }) => type === "string" || type === "boolean",
  );
  const numeric = fields.filter(
    ({ type }) => type === "number" || type === "integer" || type === "decimal",
  );
  const x = temporal ?? categorical ?? numeric[0];
  const y = numeric.find(({ fieldId }) => fieldId !== x?.fieldId) ?? numeric[0];
  if (!x || !y) return spec;
  return {
    ...spec,
    ...(spec.autoBind ? { autoBind: false } : {}),
    xField: x.fieldId,
    xTimeUnit: temporal ? (spec.xTimeUnit ?? "month") : "none",
    yField: y.fieldId,
    yAggregation: spec.yAggregation ?? "sum",
    fieldLabels: { [x.fieldId]: x.name, [y.fieldId]: y.name },
  };
}

export function migrateChartSpec(
  spec: ChartSpec,
  binding: { cellId: string; exportId: string },
  fields: readonly ResultField[],
): ChartSpec | null {
  if (spec.version === 3)
    return spec.autoBind ? bindDefaultChartAxes(spec, fields) : spec;
  function fieldId(name: string | null) {
    if (name === null) return null;
    const matches = fields.filter((field) => field.name === name);
    return matches.length === 1 ? matches[0]?.fieldId : undefined;
  }
  const xField = fieldId(spec.xField);
  const yField = fieldId(spec.yField);
  const seriesField = fieldId(spec.seriesField);
  const secondaryYField =
    spec.secondaryYField === undefined
      ? undefined
      : fieldId(spec.secondaryYField);
  const endField =
    spec.endField === undefined ? undefined : fieldId(spec.endField);
  const yFields = spec.yFields?.map(fieldId);
  if (
    xField === undefined ||
    yField === undefined ||
    seriesField === undefined ||
    (spec.secondaryYField !== undefined && secondaryYField === undefined) ||
    (spec.endField !== undefined && endField === undefined) ||
    yFields?.some((id) => id == null)
  )
    return null;
  return {
    ...spec,
    version: 3,
    revision: 0,
    sourceCellId: binding.cellId,
    sourceExportId: binding.exportId,
    xField,
    yField,
    seriesField,
    ...(secondaryYField !== undefined ? { secondaryYField } : {}),
    ...(endField !== undefined ? { endField } : {}),
    fieldLabels: Object.fromEntries(
      fields
        .filter(({ fieldId }) =>
          [
            xField,
            yField,
            seriesField,
            secondaryYField ?? null,
            endField ?? null,
            ...(yFields ?? []),
          ].includes(fieldId),
        )
        .map(({ fieldId, name }) => [fieldId, name]),
    ),
    ...(yFields ? { yFields: yFields.filter((id) => id != null) } : {}),
  };
}
