import {
  scanSqlTemplate,
  sqlTemplateInputNames,
} from "../../app/lib/model/sql-template-names.js";

export { sqlTemplateInputNames } from "../../app/lib/model/sql-template-names.js";

/** Numbers bind as INT64 or FLOAT64 so a numeric choice keeps its type. */
export type SqlTemplateValue = string | number | Array<string | number>;
export type BigQueryTemplateParameter = {
  name: string;
  parameterType: { type: "STRING" | "INT64" | "FLOAT64" };
  parameterValue: { value: string };
};

/** The value a bound parameter carries into a query runner. */
export function templateParameterValue(
  parameter: BigQueryTemplateParameter,
): string | number {
  return parameter.parameterType.type === "STRING"
    ? parameter.parameterValue.value
    : Number(parameter.parameterValue.value);
}

export class SqlTemplateError extends Error {}

export function hasSqlTemplate(source: string): boolean {
  return /\{\{|\}\}/.test(source);
}

export function positionalParameterValues(
  parameters: readonly BigQueryTemplateParameter[],
): (string | number)[] {
  return parameters.map(templateParameterValue);
}

/** Compile values as BigQuery parameters; identifier substitutions require an explicit allowlist. */
export function compileSqlTemplate(
  template: string,
  values: Record<string, SqlTemplateValue>,
  identifierOptions: Record<string, readonly string[]> = {},
  options: { unquotedValues?: boolean; positional?: boolean } = {},
): { sql: string; parameters: BigQueryTemplateParameter[] } {
  const tokens = scanSqlTemplate(template);
  let sql = "";
  let block: { name: string; active: boolean } | undefined;
  const parameters: BigQueryTemplateParameter[] = [];
  const bind = (value: string | number): string => {
    const name = `template_${parameters.length}`;
    parameters.push({
      name,
      parameterType: {
        type:
          typeof value === "string"
            ? "STRING"
            : Number.isInteger(value)
              ? "INT64"
              : "FLOAT64",
      },
      parameterValue: { value: String(value) },
    });
    return options.positional ? `$${parameters.length}` : `@${name}`;
  };
  for (const token of tokens) {
    if (token.kind === "blockStart") {
      if (block)
        throw new SqlTemplateError("Invalid or nested SQL template block");
      const value = values[token.name];
      block = {
        name: token.name,
        active:
          value !== undefined &&
          (Array.isArray(value) || typeof value === "string"
            ? value.length > 0
            : true),
      };
      continue;
    }
    if (token.kind === "blockEnd") {
      if (!block || block.name !== token.name)
        throw new SqlTemplateError("Invalid or nested SQL template block");
      block = undefined;
      continue;
    }
    if (block && !block.active) continue;
    if (token.kind === "invalid")
      throw new SqlTemplateError("Invalid SQL template placeholder");
    if (token.kind === "text") {
      sql += token.text;
      continue;
    }
    if (token.kind === "single") {
      if (/\{\{|\}\}/.test(token.text)) {
        const name = sqlTemplateInputNames(token.text)[0];
        if (name !== undefined)
          throw new SqlTemplateError(
            `Filtered SQL template placeholders must not be quoted: ${name}`,
          );
        throw new SqlTemplateError("Invalid SQL template placeholder");
      }
      sql += token.text;
      continue;
    }
    const { name, quoted, filter } = token;
    const list = filter === "list" || filter === "array";
    if (!(name in values))
      throw new SqlTemplateError(`Missing SQL template value: ${name}`);
    const value = values[name];
    if (value === undefined)
      throw new SqlTemplateError(`Missing SQL template value: ${name}`);
    if (list) {
      if (!Array.isArray(value) || !value.length)
        throw new SqlTemplateError(
          `Expected a nonempty SQL template list: ${name}`,
        );
      sql += value.map(bind).join(", ");
      continue;
    }
    if (filter === "sql_literal") {
      if (Array.isArray(value))
        throw new SqlTemplateError(
          `Expected a single SQL template value: ${name}`,
        );
      sql += bind(value);
      continue;
    }
    if (quoted || options.unquotedValues) {
      sql += bind(Array.isArray(value) ? value.join(",") : value);
      continue;
    }
    if (Array.isArray(value))
      throw new SqlTemplateError(
        `Expected a single SQL template value: ${name}`,
      );
    if (
      typeof value !== "string" ||
      !identifierOptions[name]?.includes(value) ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    )
      throw new SqlTemplateError(
        `SQL template identifier is not allowed: ${name}`,
      );
    sql += `\`${value}\``;
  }
  if (block) throw new SqlTemplateError("Invalid or nested SQL template block");
  return { sql, parameters };
}
