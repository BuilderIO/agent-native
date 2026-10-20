import type { ResultField } from "../contract.js";
import type { OperationField } from "../operations.js";
import { isRecord } from "./bounds.js";

/** The answer shape for an operation field the model writes; `json` fields cannot be model-written. */
export function resultFieldFor(field: OperationField): ResultField | null {
  const description = field.label;
  switch (field.type) {
    case "string":
    case "text":
      return { type: "string", ...(description ? { description } : {}) };
    case "number":
      return { type: "number", ...(description ? { description } : {}) };
    case "boolean":
      return { type: "boolean", ...(description ? { description } : {}) };
    case "enum":
      return field.enum
        ? {
            type: "enum",
            enum: field.enum,
            ...(description ? { description } : {}),
          }
        : null;
    case "json":
      return null;
  }
}

type Checked =
  | { ok: true; fields: Record<string, unknown> }
  | {
      ok: false;
      message: string;
      /** The declared field that failed; absent when the answer as a whole is not fields. */
      field?: string;
    };

function typeProblem(
  name: string,
  spec: ResultField,
  value: unknown,
): string | null {
  switch (spec.type) {
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `"${name}" must be true or false`;
    case "string":
      return typeof value === "string" && value.trim() !== ""
        ? null
        : `"${name}" must be non-empty text`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `"${name}" must be a number`;
    case "enum":
      return typeof value === "string" && (spec.enum ?? []).includes(value)
        ? null
        : `"${name}" must be one of ${(spec.enum ?? []).join(", ")}`;
    case "array":
      return Array.isArray(value) ? null : `"${name}" must be a list`;
  }
}

/**
 * Checks a model's answer against the fields the node declared. The runner
 * validates too; this is the engine's own check, because nothing a model said
 * goes downstream on the runner's word alone. Only declared fields come out.
 * An optional field the model left out is stored as null, so a later rule can
 * ask whether it is empty without tripping over a missing path.
 */
export function validateAiFields(
  answer: unknown,
  schema: Readonly<Record<string, ResultField>>,
): Checked {
  if (!isRecord(answer)) {
    return { ok: false, message: "the answer is not an object of fields" };
  }
  const fields: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(schema)) {
    const given = Object.prototype.hasOwnProperty.call(answer, name)
      ? answer[name]
      : undefined;
    if (given === undefined || given === null) {
      if (spec.optional) {
        fields[name] = null;
        continue;
      }
      return { ok: false, message: `"${name}" is missing`, field: name };
    }
    const problem = typeProblem(name, spec, given);
    if (problem) return { ok: false, message: problem, field: name };
    fields[name] = given;
  }
  return { ok: true, fields };
}
