import type { StandardSchemaV1 } from "@standard-schema/spec";

import { ActionError, ActionPostCommitError } from "./errors.js";
import type { JsonSchemaObject } from "./types.js";

interface StandardJsonSchemaCapability {
  jsonSchema?: {
    input?: (options: { target: string }) => unknown;
    output?: (options: { target: string }) => unknown;
  };
}

const NO_COERCE = Symbol("no-coerce");

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatIssuePath(
  path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined,
): string {
  if (!path || path.length === 0) return "";
  return path
    .map((segment) =>
      typeof segment === "object" && "key" in segment
        ? String(segment.key)
        : String(segment),
    )
    .join(".");
}

function coerceStringToSchemaType(raw: string, types: string[]): unknown {
  const trimmed = raw.trim();
  if (types.includes("boolean")) {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
  }
  if (
    (types.includes("array") &&
      trimmed.startsWith("[") &&
      trimmed.endsWith("]")) ||
    (types.includes("object") &&
      trimmed.startsWith("{") &&
      trimmed.endsWith("}"))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (types.includes("array") && Array.isArray(parsed)) return parsed;
      if (types.includes("object") && isPlainRecord(parsed)) {
        return parsed;
      }
    } catch {
      // coercion-ok: unparseable text stays a string so schema validation reports the real error
    }
  }
  if (
    (types.includes("number") || types.includes("integer")) &&
    trimmed !== "" &&
    Number.isFinite(Number(trimmed))
  ) {
    const n = Number(trimmed);
    if (types.includes("number") || Number.isInteger(n)) return n;
  }
  return NO_COERCE;
}

/**
 * Repair LLM/gateway-stringified arguments before schema validation: undo
 * stringified booleans (`"true"`), numbers (`"3"`), and JSON arrays/objects per
 * the declared JSON Schema property types, and convert booleans for string
 * `"true"`/`"false"` enums. Returns the original object reference when nothing
 * changes.
 */
export function coerceGatewayStringifiedArgs(
  args: unknown,
  parameters?: { properties?: Record<string, unknown> } | null,
): unknown {
  const properties = parameters?.properties as
    | Record<string, { type?: string | string[]; enum?: unknown[] }>
    | undefined;
  if (!properties) return args;
  if (!isPlainRecord(args)) return args;

  let out: Record<string, unknown> | null = null;
  for (const [key, raw] of Object.entries(args)) {
    const spec = properties[key];
    if (!spec) continue;
    if (typeof raw === "boolean" && spec.enum?.includes(String(raw))) {
      out ??= { ...args };
      out[key] = String(raw);
      continue;
    }
    if (typeof raw !== "string") continue;
    const types = Array.isArray(spec.type)
      ? spec.type
      : spec.type
        ? [spec.type]
        : [];
    if (types.length === 0 || types.includes("string")) continue;
    const coerced = coerceStringToSchemaType(raw, types);
    if (coerced === NO_COERCE) continue;
    out ??= { ...args };
    out[key] = coerced;
  }
  return out ?? args;
}

export async function validateInputSchema<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  rawInput: unknown,
  actionName: string,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
  const result = await schema["~standard"].validate(rawInput);
  if (result.issues) {
    const formatted = result.issues.map((issue) => {
      const pathStr = formatIssuePath(issue.path);
      return pathStr ? `${pathStr}: ${issue.message}` : issue.message;
    });
    throw new ActionError(
      `Invalid input for "${actionName}": ${formatted.join("; ")}`,
      {
        statusCode: 400,
        errorCode: "invalid_input",
        details: {
          issues: result.issues.map((issue) => ({
            path: formatIssuePath(issue.path),
            message: issue.message,
          })),
        },
      },
    );
  }
  return result.value;
}

export async function validateOutputSchema<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  rawOutput: unknown,
  actionName: string,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
  const result = await schema["~standard"].validate(rawOutput);
  if (result.issues) {
    const formatted = result.issues.map((issue) => {
      const pathStr = formatIssuePath(issue.path);
      return pathStr ? `${pathStr}: ${issue.message}` : issue.message;
    });
    throw new ActionPostCommitError(
      `Action "${actionName}" returned output that violated outputSchema: ${formatted.join("; ")}`,
      undefined,
      {
        issues: result.issues.map((issue) => ({
          path: formatIssuePath(issue.path),
          message: issue.message,
        })),
      },
    );
  }
  return result.value;
}

export function schemaToJsonSchema(
  schema: StandardSchemaV1 | undefined,
  mode: "input" | "output",
  explicitOverride?: JsonSchemaObject,
): JsonSchemaObject | null {
  if (mode === "input" && explicitOverride) {
    return structuredClone(explicitOverride);
  }
  if (!schema) {
    return mode === "input"
      ? { type: "object", properties: {}, additionalProperties: false }
      : null;
  }

  const standard = schema["~standard"] as StandardSchemaV1.Props &
    StandardJsonSchemaCapability;
  const converter =
    mode === "input" ? standard.jsonSchema?.input : standard.jsonSchema?.output;

  if (typeof converter !== "function") {
    return null;
  }

  const converted = converter({ target: "draft-2020-12" });
  if (!isPlainRecord(converted)) {
    return null;
  }
  const copy = structuredClone(converted);
  delete copy["$schema"];
  return copy;
}

/**
 * Normalize common LLM strict-mode quirks where optional fields are sent as
 * `null` or gateway-stringified primitives/objects/arrays when the JSON Schema
 * does not expect those types.
 */
export function normalizeLlmToolInput(
  rawInput: unknown,
  jsonSchema: JsonSchemaObject | null,
): unknown {
  if (!isPlainRecord(rawInput) || !jsonSchema) {
    return rawInput;
  }
  const properties = isPlainRecord(jsonSchema["properties"])
    ? jsonSchema["properties"]
    : null;
  if (!properties) {
    return rawInput;
  }

  const coerced = coerceGatewayStringifiedArgs(rawInput, {
    properties,
  }) as Record<string, unknown>;

  const required = new Set(
    Array.isArray(jsonSchema["required"])
      ? jsonSchema["required"].filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  );

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(coerced)) {
    const fieldSchema = isPlainRecord(properties[key]) ? properties[key] : null;
    if (!fieldSchema) {
      out[key] = value;
      continue;
    }

    const fieldType = fieldSchema["type"];
    const allowsNull =
      fieldType === "null" ||
      (Array.isArray(fieldType) && fieldType.includes("null")) ||
      (Array.isArray(fieldSchema["anyOf"]) &&
        fieldSchema["anyOf"].some(
          (branch) => isPlainRecord(branch) && branch["type"] === "null",
        ));

    if (value === null && !required.has(key) && !allowsNull) {
      continue;
    }

    if (isPlainRecord(value) && fieldType === "object") {
      out[key] = normalizeLlmToolInput(value, fieldSchema);
      continue;
    }

    out[key] = value;
  }
  return out;
}
