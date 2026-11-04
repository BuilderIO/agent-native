import Ajv, { type ValidateFunction } from "ajv";

import type { actionCallReadOnly } from "../action-call-classification.js";
import type { AgentNativeJsonSchema } from "./types.js";

type RawJsonSchema = AgentNativeJsonSchema;

export interface ToolInputRepair {
  input: unknown;
  changed: boolean;
  error?: AmbiguousToolPlaceholdersError;
}

const optionalPlaceholderAjv = new Ajv({
  strict: false,
  allErrors: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});

const optionalPlaceholderValidatorCache = new WeakMap<
  object,
  ValidateFunction
>();

function isStructurallyEmptyToolValue(value: unknown): boolean {
  if (value === false) return true;
  if (value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) {
    return (
      value.length === 0 ||
      value.every(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          Object.keys(item).length === 0,
      )
    );
  }
  return typeof value === "object" && Object.keys(value).length === 0;
}

function compileToolValueValidator(schema: object): ValidateFunction | null {
  const cached = optionalPlaceholderValidatorCache.get(schema);
  if (cached) return cached;
  try {
    const validator = optionalPlaceholderAjv.compile(schema);
    optionalPlaceholderValidatorCache.set(schema, validator);
    return validator;
  } catch {
    // coercion-ok: an uncompilable schema accepts and rejects nothing, so its field is left as sent.
    return null;
  }
}

export function schemaAcceptsToolValue(
  schema: object,
  value: unknown,
): boolean {
  const validator = compileToolValueValidator(schema);
  return validator ? Boolean(validator(value)) : false;
}

function schemaRejectsToolValue(schema: object, value: unknown): boolean {
  const validator = compileToolValueValidator(schema);
  return validator ? !validator(value) : false;
}

function schemaDiscriminatorValue(
  schema: AgentNativeJsonSchema | undefined,
): unknown {
  if (!schema) return undefined;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length === 1) {
    return schema.enum[0];
  }
  return undefined;
}

export function discriminatedBranchIndex(
  branches: readonly AgentNativeJsonSchema[],
  value: unknown,
): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return -1;
  const record = value as Record<string, unknown>;
  return branches.findIndex((branch) => {
    const properties = branch.properties;
    if (!properties) return false;
    const discriminators = Object.entries(properties).filter(
      ([, spec]) => schemaDiscriminatorValue(spec) !== undefined,
    );
    if (discriminators.length === 0) return false;
    return discriminators.every(
      ([key, spec]) => record[key] === schemaDiscriminatorValue(spec),
    );
  });
}

// A union of a union (an object-or-array field whose object side is itself a
// discriminated union) arrives as nested anyOf; its leaf branches are the
// alternatives.
function leafBranches(schema: RawJsonSchema): RawJsonSchema[] {
  const branches = schema.oneOf ?? schema.anyOf;
  return branches ? branches.flatMap(leafBranches) : [schema];
}

function resolveObjectSchemaBranch(
  schema: RawJsonSchema,
  value: unknown,
): RawJsonSchema | undefined {
  if (!(schema.oneOf ?? schema.anyOf)?.length) return schema;
  const branches = leafBranches(schema);
  const index = discriminatedBranchIndex(branches, value);
  return index >= 0 ? branches[index] : undefined;
}

function stripOptionalToolPlaceholders(
  schema: RawJsonSchema | undefined,
  value: unknown,
  emptyValues: { valid: boolean; invalid: boolean; nullOnly: boolean },
): { value: unknown; changed: boolean } {
  if (!schema) return { value, changed: false };

  if (Array.isArray(value)) {
    const itemSchema = leafBranches(schema).find(
      (branch) => branch.items,
    )?.items;
    if (!itemSchema) return { value, changed: false };
    const results = value.map((item) =>
      stripOptionalToolPlaceholders(itemSchema, item, emptyValues),
    );
    return results.some((result) => result.changed)
      ? { value: results.map((result) => result.value), changed: true }
      : { value, changed: false };
  }

  if (!value || typeof value !== "object") return { value, changed: false };

  const objectSchema = resolveObjectSchemaBranch(schema, value);
  const properties = objectSchema?.properties;
  if (!properties) return { value, changed: false };

  const required = new Set(
    Array.isArray(objectSchema.required) ? objectSchema.required : [],
  );
  const record = value as Record<string, unknown>;
  const placeholders: string[] = [];
  let normalized: Record<string, unknown> | null = null;

  for (const [key, entry] of Object.entries(record)) {
    const propertySchema = Object.hasOwn(properties, key)
      ? properties[key]
      : undefined;
    if (!propertySchema) {
      // Root unions are flattened by providers; an unused branch can arrive as null.
      const branches = schema.oneOf ?? schema.anyOf;
      if (
        entry === null &&
        objectSchema.additionalProperties === false &&
        branches?.some((branch) =>
          branch.properties ? Object.hasOwn(branch.properties, key) : false,
        )
      ) {
        placeholders.push(key);
      }
      continue;
    }
    if (!required.has(key) && isStructurallyEmptyToolValue(entry)) {
      if (schemaRejectsToolValue(propertySchema, entry)) {
        if (emptyValues.nullOnly && entry !== null) continue;
        emptyValues.invalid = true;
        placeholders.push(key);
        continue;
      }
      // A valid `false` sets a value, and `[]` is what a model that pads every
      // field sends for an unused list, so neither counts as a clear. An empty
      // equal to the schema's own default changes nothing either.
      if (
        entry !== false &&
        !(Array.isArray(entry) && entry.length === 0) &&
        schemaAcceptsToolValue(propertySchema, entry) &&
        !(
          propertySchema.default !== undefined &&
          JSON.stringify(propertySchema.default) === JSON.stringify(entry)
        )
      )
        emptyValues.valid = true;
    }
    const nested = stripOptionalToolPlaceholders(
      propertySchema,
      entry,
      emptyValues,
    );
    if (nested.changed) {
      normalized ??= { ...record };
      normalized[key] = nested.value;
    }
  }

  if (placeholders.length > 0) {
    normalized ??= { ...record };
    for (const key of placeholders) delete normalized[key];
  }

  return normalized
    ? { value: normalized, changed: true }
    : { value, changed: false };
}

export class AmbiguousToolPlaceholdersError extends Error {
  readonly errorCode = "ambiguous_tool_placeholders";

  constructor() {
    super(
      "Tool input mixes invalid placeholders with valid empty values, so it is unclear which fields should be cleared. " +
        "No action was run. Retry the native tool with sparse JSON containing only the intended changes. " +
        "If the transport keeps adding unused fields, use a dedicated operation that expresses the intended change or report this error. Mutating actions cannot run through run-code.",
    );
    this.name = "AmbiguousToolPlaceholdersError";
  }
}

export function normalizeOptionalToolPlaceholders(
  schema: RawJsonSchema | undefined,
  input: unknown,
  entry: Parameters<typeof actionCallReadOnly>[0],
  { nullOnly = false }: { nullOnly?: boolean } = {},
): ToolInputRepair {
  if (!schema || !input || typeof input !== "object") {
    return { input, changed: false };
  }
  if (Array.isArray(input)) return { input, changed: false };
  const emptyValues = { valid: false, invalid: false, nullOnly };
  const result = stripOptionalToolPlaceholders(schema, input, emptyValues);
  // Only a declared read is exempt: a dynamic plan-mode effect classifies the
  // raw input, which defaults can turn into a write.
  if (
    emptyValues.valid &&
    emptyValues.invalid &&
    !(entry.readOnly === true && entry.planMode === undefined)
  ) {
    return {
      input,
      changed: false,
      error: new AmbiguousToolPlaceholdersError(),
    };
  }
  return { input: result.value, changed: result.changed };
}
