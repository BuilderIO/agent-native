import { z } from "zod";

import type { CellContents } from "../../app/lib/model/contracts.js";
import { isNumericNotebookInput } from "../../shared/notebook-input-values.js";
import {
  sqlTemplateBlock,
  sqlTemplateParameter,
} from "../../shared/sql-input-name.js";

const scalarTypes = [
  "STRING",
  "BOOL",
  "INT64",
  "NUMERIC",
  "FLOAT64",
  "DATE",
  "TIMESTAMP",
] as const;

export const bigQueryParameterSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  parameterType: z.strictObject({ type: z.enum(scalarTypes) }),
  parameterValue: z.strictObject({ value: z.string().nullable() }),
});

export type BigQueryParameter = z.infer<typeof bigQueryParameterSchema>;
type Scalar = {
  type: BigQueryParameter["parameterType"]["type"];
  value: string | null;
};
type Binding = Scalar | Scalar[];

export class SqlBindingError extends Error {}

function numberBinding(value: string): Scalar {
  if (value === "") return { type: "NUMERIC", value: null };
  if (!isNumericNotebookInput(value)) throw new SqlBindingError();
  if (/^-?\d+$/.test(value)) {
    const integer = BigInt(value);
    if (integer >= -(2n ** 63n) && integer < 2n ** 63n)
      return { type: "INT64", value: integer.toString() };
  }
  return { type: /e/i.test(value) ? "FLOAT64" : "NUMERIC", value };
}

export function inputBinding(
  input: Extract<CellContents, { kind: "input" }>,
): Binding {
  const value = input.defaultValueString;
  const choiceBinding = (choice: string): Scalar =>
    input.optionValueType === "number"
      ? numberBinding(choice)
      : { type: "STRING", value: choice };
  switch (input.inputType) {
    case "TEXT_INPUT":
      return { type: "STRING", value };
    case "DROPDOWN":
      if (input.optional && value === "")
        return {
          type: input.optionValueType === "number" ? "NUMERIC" : "STRING",
          value: null,
        };
      if (
        !input.dynamicOptions &&
        input.options &&
        !input.options.includes(value)
      )
        throw new SqlBindingError();
      return choiceBinding(value);
    case "MULTISELECT": {
      const values = z.array(z.string()).parse(JSON.parse(value || "[]"));
      if (
        !input.dynamicOptions &&
        input.options &&
        values.some((item) => !input.options?.includes(item))
      )
        throw new SqlBindingError();
      return values.map(choiceBinding);
    }
    case "CHECKBOX":
      if (value !== "true" && value !== "false") throw new SqlBindingError();
      return { type: "BOOL", value };
    case "DATE":
      if (value !== "") z.iso.date().parse(value);
      return { type: "DATE", value: value === "" ? null : value };
    case "NUMERIC_INPUT":
    case "SLIDER":
      return numberBinding(value);
    case "BUTTON":
    case "FILE_UPLOAD":
    case "TABLE":
      throw new SqlBindingError();
  }
}

export type CompiledSql = {
  sql: string;
  parameters: BigQueryParameter[];
};

export type WarehouseDialect = "bigquery" | "sample" | "postgres";

export function compileNotebookSql(
  template: string,
  bindings: ReadonlyMap<string, Binding>,
  dialect: WarehouseDialect | "dataframes",
): CompiledSql {
  const parameters: BigQueryParameter[] = [];
  const get = (name: string) => {
    const value = bindings.get(name);
    if (value === undefined) throw new SqlBindingError();
    return value;
  };
  const bind = (value: Scalar) => {
    const name = `template_${parameters.length}`;
    parameters.push({
      name,
      parameterType: { type: value.type },
      parameterValue: { value: value.value },
    });
    if (dialect === "bigquery") return `@${name}`;
    if (dialect === "dataframes" && value.value !== null)
      return `$${parameters.length}`;
    const type = {
      FLOAT64: "double precision",
      STRING: "text",
      BOOL: "boolean",
      INT64: "bigint",
      NUMERIC: dialect === "dataframes" ? "decimal(38,9)" : "numeric",
      DATE: "date",
      TIMESTAMP: "timestamptz",
    }[value.type];
    return `CAST($${parameters.length} AS ${type})`;
  };
  const sql = template
    .replace(sqlTemplateBlock, (_match, name: string, body: string) => {
      const value = get(name);
      return (
        Array.isArray(value)
          ? value.length > 0
          : value.value !== null &&
            value.value !== "" &&
            !(value.type === "BOOL" && value.value === "false")
      )
        ? body
        : "";
    })
    .replace(
      sqlTemplateParameter,
      (
        _match,
        quoted: string | undefined,
        unquoted: string | undefined,
        list: string | undefined,
      ) => {
        const name = quoted ?? unquoted;
        if (!name) throw new SqlBindingError();
        const value = get(name);
        if (!Array.isArray(value)) {
          if (list) throw new SqlBindingError();
          return bind(value);
        }
        if (quoted && !list) {
          return bind({
            type: "STRING",
            value: value
              .map((item) => item.value ?? "")
              .filter(Boolean)
              .join(","),
          });
        }
        if (!list || !value.length) throw new SqlBindingError();
        return value.map(bind).join(", ");
      },
    );
  if (/\{\{|\}\}/.test(sql)) throw new SqlBindingError();
  return { sql, parameters };
}
