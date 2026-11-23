import type { ChartSpec } from "../../app/lib/model/contracts.js";
import { chartMeasureFieldIds } from "../../shared/chart-visualization-config.js";
import {
  resultFieldSchema,
  type ResultField,
} from "../../shared/notebook-result-contract.js";
import type { PivotConfigV2, PivotScalar } from "../../shared/pivot-config.js";
import type {
  TableFilter,
  TableConfig,
} from "../../shared/table-visualization-config.js";

export const VISUALIZATION_GROUP_LIMIT = 10_000;
const PAGE_SIZE = 50;
const groupProbe = VISUALIZATION_GROUP_LIMIT + 1;

export class VisualizationBindingError extends Error {}

type Aggregation =
  | PivotConfigV2["values"][number]["aggregation"]
  | NonNullable<ChartSpec["yAggregation"]>;
type Sort = NonNullable<TableConfig["sort"]>;

export function numberField(field: ResultField) {
  return (
    field.type === "number" ||
    field.type === "integer" ||
    field.type === "decimal"
  );
}

function fieldType(field: ResultField) {
  switch (field.type) {
    case "number":
      return "DOUBLE PRECISION";
    case "integer":
      return "BIGINT";
    case "decimal":
      return "DECIMAL(38, 9)";
    case "boolean":
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "datetime":
      return "TIMESTAMP";
    case "time":
      return "TIME";
    case "binary":
    case "json":
    case "list":
    case "null":
    case "string":
    case "struct":
      return "VARCHAR";
  }
}

function textLiteral(value: string) {
  return `decode(from_hex('${Buffer.from(value).toString("hex")}'))`;
}

function literal(value: PivotScalar, field: ResultField) {
  if (value === null) return "NULL";
  if (
    field.type === "number" &&
    typeof value === "number" &&
    Number.isFinite(value)
  )
    return String(value);
  if (field.type === "boolean" && typeof value === "boolean")
    return value ? "TRUE" : "FALSE";
  if (
    field.type === "integer" &&
    typeof value === "number" &&
    Number.isSafeInteger(value)
  )
    return String(value);
  if (
    typeof value === "string" &&
    field.type !== "number" &&
    field.type !== "boolean" &&
    field.type !== "binary"
  )
    return `CAST(${textLiteral(value)} AS ${fieldType(field)})`;
  throw new VisualizationBindingError(
    "Filter value does not match the result field",
  );
}

function displayValue(expression: string, field: ResultField) {
  if (field.type === "binary") return `to_base64(${expression})`;
  if (field.type === "boolean" || field.type === "number") return expression;
  return `CAST(${expression} AS VARCHAR)`;
}

function aggregate(
  expression: string,
  field: ResultField,
  operation: Aggregation,
) {
  if (operation === "count") return `count(${expression})`;
  if (operation === "count-distinct" || operation === "distinct_count")
    return `count(DISTINCT ${expression})`;
  if (!numberField(field))
    throw new VisualizationBindingError(
      "This aggregate requires a number field",
    );
  switch (operation) {
    case "none":
      return expression;
    case "average":
      return `avg(${expression})`;
    case "stddevpop":
      return `stddev_pop(${expression})`;
    case "variancepop":
      return `var_pop(${expression})`;
    case "stddev":
      return `stddev_samp(${expression})`;
    case "variance":
      return `var_samp(${expression})`;
    case "min":
      return `min(${expression})`;
    case "max":
      return `max(${expression})`;
    case "sum":
      return `sum(${expression})`;
    case "median":
      return `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${expression})`;
  }
}

function jsonArray(expressions: string[]) {
  if (!expressions.length) return "CAST('[]' AS JSON)";
  const values = expressions.map((expression) =>
    expression === "NULL" ? "CAST(NULL AS JSON)" : `to_json(${expression})`,
  );
  return `to_json(ARRAY[${values.join(", ")}])`;
}

export function visualizationSql(fields: ResultField[]) {
  function find(id: string) {
    const index = fields.findIndex((field) => field.fieldId === id);
    const field = fields[index];
    if (!field) throw new VisualizationBindingError("Result field was removed");
    const raw = `"${index}"`;
    const expression =
      field.type === "binary" ? raw : `CAST(${raw} AS ${fieldType(field)})`;
    return { field, expression, raw };
  }

  function predicate(filter: TableFilter) {
    const { field, expression } = find(filter.fieldId);
    switch (filter.op) {
      case "is-null":
        return `${expression} IS NULL`;
      case "is-not-null":
        return `${expression} IS NOT NULL`;
      case "in":
      case "not-in": {
        const match = filter.values
          .map(
            (value) =>
              `${expression} IS NOT DISTINCT FROM ${literal(value, field)}`,
          )
          .join(" OR ");
        return filter.op === "not-in" ? `NOT (${match})` : `(${match})`;
      }
      case "eq":
        return `${expression} IS NOT DISTINCT FROM ${literal(filter.value, field)}`;
      case "neq":
        return `${expression} IS DISTINCT FROM ${literal(filter.value, field)}`;
      case "lt":
        return `${expression} < ${literal(filter.value, field)}`;
      case "lte":
        return `${expression} <= ${literal(filter.value, field)}`;
      case "gt":
        return `${expression} > ${literal(filter.value, field)}`;
      case "gte":
        return `${expression} >= ${literal(filter.value, field)}`;
      case "contains":
      case "not-contains": {
        if (typeof filter.value !== "string" || field.type !== "string")
          throw new VisualizationBindingError(
            "Text filters require a text field",
          );
        const match = `contains(lower(${expression}), lower(${textLiteral(filter.value)}))`;
        return filter.op === "contains" ? match : `NOT ${match}`;
      }
    }
  }

  function filtered(filters: TableFilter[], excluded: TableFilter[][] = []) {
    const conditions = [
      ...filters.map(predicate),
      ...excluded.map(
        (selection) =>
          `NOT coalesce((${selection.map(predicate).join(" AND ")}), false)`,
      ),
    ];
    return `SELECT * FROM input${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}`;
  }

  function page(
    source: string,
    row: string,
    order: string,
    totals: string[],
    requestedPage: number,
  ) {
    const rows = `coalesce(
        (SELECT to_json(array_agg(row_payload ORDER BY idx)) FROM numbered
         WHERE idx > (page - 1) * ${PAGE_SIZE} AND idx <= page * ${PAGE_SIZE}),
        CAST('[]' AS JSON)
      )`;
    return `WITH filtered AS MATERIALIZED (${source}),
      metadata AS (SELECT count(*) AS n, ${jsonArray(totals)} AS totals FROM filtered),
      numbered AS (SELECT ${row} AS row_payload, row_number() OVER (${order}) AS idx FROM filtered),
      bounds AS (SELECT greatest(1, least(${requestedPage}, CAST(floor((n + 49) / 50) AS BIGINT))) AS page, n, totals FROM metadata)
      SELECT ${jsonArray(["n", "page", "totals", rows])} AS payload
      FROM bounds`;
  }

  function table(
    filters: TableFilter[],
    sort: Sort | null,
    totals: TableConfig["totals"],
    requestedPage: number,
    excluded?: TableFilter[][],
  ) {
    const ordered = sort ? find(sort.fieldId) : null;
    const order =
      ordered && sort
        ? `ORDER BY ${ordered.expression} ${sort.direction === "asc" ? "ASC" : "DESC"} NULLS LAST, ordinal`
        : "ORDER BY ordinal";
    for (const id of Object.keys(totals)) find(id);
    return page(
      `SELECT t.*, row_number() OVER () AS ordinal FROM (${filtered(filters, excluded)}) AS t`,
      jsonArray(
        fields.map((field) => displayValue(find(field.fieldId).raw, field)),
      ),
      order,
      fields.map((field) => {
        const operation = totals[field.fieldId];
        return operation
          ? `CAST(${aggregate(find(field.fieldId).expression, field, operation)} AS VARCHAR)`
          : "NULL";
      }),
      requestedPage,
    );
  }

  function chart(spec: ChartSpec) {
    if (!spec.xField)
      throw new VisualizationBindingError("Chart has no X field");
    const x = find(spec.xField);
    const configuredUnit =
      spec.xTimeUnit ??
      (x.field.type === "date" || x.field.type === "datetime"
        ? "month"
        : "none");
    const unit =
      x.field.type === "date" &&
      ["hour", "minute", "second"].includes(configuredUnit)
        ? "day"
        : configuredUnit;
    const bucket =
      unit !== "none" &&
      (x.field.type === "date" || x.field.type === "datetime");
    const xExpression = bucket
      ? `date_trunc('${unit}', ${x.expression})`
      : x.expression;
    const xOutput = x.field.type === "date" ? "CAST(x AS DATE)" : "x";
    const series = spec.seriesField ? find(spec.seriesField) : null;
    const yFields = chartMeasureFieldIds(spec);
    if (series && yFields.length > 1)
      throw new VisualizationBindingError(
        "Choose one measure when coloring by a field",
      );
    const groups = yFields.map((id) => {
      const y = id ? find(id) : null;
      if (!y && !spec.countRecords)
        throw new VisualizationBindingError("Chart has no Y field");
      const operation = spec.yAggregation ?? "sum";
      const value = y
        ? aggregate(y.expression, y.field, operation)
        : "count(*)";
      const seriesExpression =
        series?.expression ??
        (yFields.length > 1 && y ? textLiteral(y.field.name) : "NULL");
      const groupBy =
        operation === "none" && y
          ? ""
          : series
            ? "GROUP BY x, series"
            : "GROUP BY x";
      return `SELECT ${xExpression} x, ${seriesExpression} series, CAST(${value} AS DOUBLE PRECISION) AS value FROM filtered ${groupBy}`;
    });
    const palette = series
      ? `SELECT DISTINCT ${series.expression} AS category FROM input ORDER BY category NULLS FIRST LIMIT ${groupProbe}`
      : "SELECT CAST(NULL AS VARCHAR) AS category WHERE false";
    const markPayload = jsonArray([
      "0",
      displayValue(xOutput, x.field),
      series ? displayValue("series", series.field) : "series",
      "value",
    ]);
    const palettePayload = jsonArray([
      "1",
      series ? displayValue("category", series.field) : "category",
      "NULL",
      "NULL",
    ]);
    return {
      bucket: bucket ? unit : null,
      source: `WITH filtered AS (${filtered(spec.filters ?? [], spec.excludedMarks)}),
        grouped AS (${groups.join(" UNION ALL ")} ORDER BY x NULLS FIRST, series NULLS FIRST, value NULLS FIRST LIMIT ${groupProbe}),
        palette AS (${palette})
        SELECT ${markPayload} AS payload FROM grouped
        UNION ALL
        SELECT ${palettePayload} AS payload FROM palette`,
    };
  }

  function pivot(
    config: PivotConfigV2,
    drillFilters: TableFilter[] = [],
    drillField?: string,
    requestedPage = 1,
  ) {
    const rows = config.rows.map(find);
    const columns = config.columns.map(find);
    const dimensions = [...rows, ...columns].map((field, index) => ({
      ...field,
      alias: `d${index}`,
    }));
    const measures = config.values.map(({ fieldId, aggregation }, index) => {
      const { expression, field } = find(fieldId);
      return {
        alias: `v${index}`,
        expression: `CAST(${aggregate(expression, field, aggregation)} AS DOUBLE PRECISION)`,
      };
    });
    const source = filtered([...config.filters, ...drillFilters]);
    if (drillField) {
      const field = find(drillField);
      return page(
        `SELECT ${field.expression} AS dimension, ${measures.map(({ alias, expression }) => `${expression} AS ${alias}`).join(", ")} FROM (${source}) t GROUP BY dimension`,
        jsonArray([
          displayValue("dimension", field.field),
          ...measures.map(({ alias }) => alias),
        ]),
        "ORDER BY dimension NULLS FIRST",
        [],
        requestedPage,
      );
    }
    function axisGroups(length: number, totals: boolean, start: number) {
      const sizes = [length];
      if (config.subtotals)
        for (let size = length - 1; size > 0; size--) sizes.push(size);
      if (totals && length) sizes.push(0);
      return sizes.map((size) =>
        dimensions.slice(start, start + size).map(({ alias }) => alias),
      );
    }
    const groupingSets = axisGroups(
      rows.length,
      config.columnTotals,
      0,
    ).flatMap((r) =>
      axisGroups(columns.length, config.rowTotals, rows.length).map(
        (c) => `(${[...r, ...c].join(", ")})`,
      ),
    );
    const grouped = dimensions.length
      ? `GROUP BY GROUPING SETS (${groupingSets.join(", ")})`
      : "";
    const projections = dimensions.map(
      ({ expression, alias }) => `${expression} AS ${alias}`,
    );
    const bits = dimensions.map(({ alias }) => `grouping(${alias})`);
    const key = dimensions.map(({ alias, field }) =>
      displayValue(alias, field),
    );
    const data = measures.map(({ expression }) => expression);
    const ordering = [
      ...(bits.length ? [`(${bits.join(" + ")}) DESC`] : []),
      ...dimensions.flatMap(({ alias }) => [
        `grouping(${alias})`,
        `${alias} NULLS FIRST`,
      ]),
    ];
    return `WITH filtered AS (${source})
      SELECT ${jsonArray([jsonArray(bits), jsonArray(key), jsonArray(data)])} AS payload
      FROM (SELECT *, ${projections.length ? projections.join(", ") : "1 AS no_dimensions"} FROM filtered) t
      ${grouped} HAVING count(*) > 0
      ${ordering.length ? `ORDER BY ${ordering.join(", ")}` : ""}
      LIMIT ${groupProbe}`;
  }

  function chartDrill(
    spec: ChartSpec,
    selection: TableFilter[],
    id: string,
    requestedPage: number,
  ) {
    const { field, expression } = find(id);
    const ids = chartMeasureFieldIds(spec);
    const operation = spec.yAggregation ?? "sum";
    const aggregateRows = operation !== "none" || spec.countRecords;
    const values = ids.map((valueId, index) => {
      const measure = valueId ? find(valueId) : null;
      return {
        expression: measure
          ? aggregate(measure.expression, measure.field, operation)
          : "count(*)",
        alias: `value_${index}`,
        name: measure?.field.name ?? "Count of Records",
      };
    });
    const input = filtered(
      [...(spec.filters ?? []), ...selection],
      spec.excludedMarks,
    );
    return {
      measures: values.map(({ alias, name }) =>
        resultFieldSchema.parse({
          fieldId: alias,
          name,
          type: "number",
          nullable: true,
        }),
      ),
      source: page(
        `SELECT ${expression} AS dimension, ${values.map((value) => `CAST(${value.expression} AS DOUBLE PRECISION) AS ${value.alias}`).join(", ")}
          FROM (${input}) t ${aggregateRows ? "GROUP BY dimension" : ""}`,
        jsonArray([
          displayValue("dimension", field),
          ...values.map(({ alias }) => alias),
        ]),
        "ORDER BY dimension NULLS FIRST",
        [],
        requestedPage,
      ),
    };
  }

  return { chart, chartDrill, pivot, table };
}
