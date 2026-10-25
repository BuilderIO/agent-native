import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as fc from "fast-check";
import { z } from "zod";

import type { ActionExecutionRun } from "./action-frame.js";
import {
  ActionInputValidationError,
  isActionContractError,
  isActionOutputContractError,
  runActionWithExecutionOutcome,
  type ActionDefinition,
  type ActionExecutionOutcome,
  type ActionRunContext,
} from "./action.js";

type JsonObject = Record<string, unknown>;
type JsonKind = "string" | "number" | "boolean" | "null" | "array" | "object";

export type ArbitraryOverrides = Readonly<
  Record<string, fc.Arbitrary<unknown>>
>;

export interface ArbitraryFromJsonSchemaOptions {
  /**
   * Arbitraries keyed by JSON pointer into the generated input, for values
   * the generator cannot build. Array items use the `-` token: `/tags/-`.
   */
  overrides?: ArbitraryOverrides;
}

export class UnsupportedSchemaError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(
      `Cannot generate input at JSON pointer "${path}": ${reason}. Pass overrides["${path}"] to generate it yourself.`,
    );
    this.name = "UnsupportedSchemaError";
    this.path = path;
  }
}

const ANNOTATION_KEYWORDS = [
  "$schema",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$comment",
];

const SUPPORTED_KEYWORDS = new Set([
  ...ANNOTATION_KEYWORDS,
  "type",
  "const",
  "enum",
  "anyOf",
  "oneOf",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "items",
  "minItems",
  "maxItems",
  "properties",
  "required",
  "additionalProperties",
]);

// Zod emits its own regex beside these formats. The format is what generates
// the value, and the schema re-validates every generated value, so the regex
// adds nothing here. A `pattern` with any other format is rejected below.
const SUPPORTED_FORMATS = new Set(["uuid", "email", "date-time", "uri"]);

/**
 * Build a fast-check arbitrary for a JSON Schema, such as the one
 * `z.toJSONSchema(schema, { io: "input" })` produces for a zod schema. Any
 * keyword or shape it cannot generate throws `UnsupportedSchemaError` with
 * the JSON pointer of the value, unless `overrides` supplies that value.
 */
export function arbitraryFromJsonSchema(
  schema: unknown,
  options: ArbitraryFromJsonSchemaOptions = {},
): fc.Arbitrary<unknown> {
  return arbitraryAt(schema, "", options.overrides ?? {});
}

function arbitraryAt(
  schema: unknown,
  path: string,
  overrides: ArbitraryOverrides,
): fc.Arbitrary<unknown> {
  if (Object.hasOwn(overrides, path)) return overrides[path];
  if (!isJsonObject(schema)) {
    throw new UnsupportedSchemaError(path, "it is not a JSON Schema object");
  }
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new UnsupportedSchemaError(
        path,
        `keyword "${keyword}" is not supported`,
      );
    }
  }

  const composed = ["const", "enum", "anyOf", "oneOf"].filter((keyword) =>
    Object.hasOwn(schema, keyword),
  );
  if (composed.length > 1) {
    throw new UnsupportedSchemaError(
      path,
      `${composed.join(" and ")} cannot be combined`,
    );
  }
  if (Object.hasOwn(schema, "const")) return fc.constant(schema.const);
  if (Object.hasOwn(schema, "enum")) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      throw new UnsupportedSchemaError(path, "enum must be a non-empty array");
    }
    return fc.constantFrom(...schema.enum);
  }
  if (composed.length === 1) {
    if (Object.hasOwn(schema, "type")) {
      throw new UnsupportedSchemaError(
        path,
        `type cannot be combined with ${composed[0]}`,
      );
    }
    const branches = schema.anyOf ?? schema.oneOf;
    if (!Array.isArray(branches) || branches.length === 0) {
      throw new UnsupportedSchemaError(
        path,
        `${composed[0]} must be a non-empty array`,
      );
    }
    return fc.oneof(
      ...branches.map((branch) => arbitraryAt(branch, path, overrides)),
    );
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    if (type.length === 0) {
      throw new UnsupportedSchemaError(path, "type must not be empty");
    }
    return fc.oneof(
      ...type.map((member) =>
        arbitraryAt({ ...schema, type: member }, path, overrides),
      ),
    );
  }
  switch (type) {
    case "string":
      return stringArbitrary(schema, path);
    case "number":
    case "integer":
      return numberArbitrary(schema, type, path);
    case "boolean":
      return fc.boolean();
    case "null":
      return fc.constant(null);
    case "array":
      return arrayArbitrary(schema, path, overrides);
    case "object":
      return objectArbitrary(schema, path, overrides);
    case undefined:
      throw new UnsupportedSchemaError(
        path,
        "the schema has no type, so it accepts any value",
      );
    default:
      throw new UnsupportedSchemaError(
        path,
        `type ${JSON.stringify(type)} is not supported`,
      );
  }
}

function stringArbitrary(
  schema: JsonObject,
  path: string,
): fc.Arbitrary<string> {
  const minLength = nonNegativeInteger(schema, "minLength", path) ?? 0;
  const maxLength = nonNegativeInteger(schema, "maxLength", path);
  let base: fc.Arbitrary<string>;
  if (schema.format === undefined) {
    if (schema.pattern !== undefined) {
      throw new UnsupportedSchemaError(
        path,
        '"pattern" is only supported next to a format',
      );
    }
    base = fc.string({
      minLength,
      ...(maxLength === undefined ? {} : { maxLength }),
    });
  } else {
    if (
      typeof schema.format !== "string" ||
      !SUPPORTED_FORMATS.has(schema.format)
    ) {
      throw new UnsupportedSchemaError(
        path,
        `format ${JSON.stringify(schema.format)} is not supported`,
      );
    }
    base = formatArbitrary(schema.format);
    if (minLength > 0 || maxLength !== undefined) {
      base = base.filter(
        (value) =>
          value.length >= minLength &&
          (maxLength === undefined || value.length <= maxLength),
      );
    }
  }
  return base;
}

function formatArbitrary(format: string): fc.Arbitrary<string> {
  switch (format) {
    case "uuid":
      return fc.uuid();
    case "email": {
      // Zod's email regex rejects most of fast-check's emailAddress output.
      const label = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);
      return fc
        .tuple(label, label, fc.constantFrom("com", "org", "io"))
        .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);
    }
    case "date-time":
      return fc
        .date({
          min: new Date("1970-01-01T00:00:00.000Z"),
          max: new Date("2100-01-01T00:00:00.000Z"),
          noInvalidDate: true,
        })
        .map((date) => date.toISOString());
    default:
      return fc.webUrl();
  }
}

function numberArbitrary(
  schema: JsonObject,
  type: "number" | "integer",
  path: string,
): fc.Arbitrary<number> {
  const lower = lowerBound(schema, path);
  const upper = upperBound(schema, path);
  if (type === "integer") {
    const min = lower
      ? lower.exclusive
        ? Math.floor(lower.value) + 1
        : Math.ceil(lower.value)
      : Number.MIN_SAFE_INTEGER;
    const max = upper
      ? upper.exclusive
        ? Math.ceil(upper.value) - 1
        : Math.floor(upper.value)
      : Number.MAX_SAFE_INTEGER;
    if (min > max) {
      throw new UnsupportedSchemaError(path, "no integer satisfies its bounds");
    }
    return fc.integer({ min, max });
  }
  if (
    lower &&
    upper &&
    (lower.value > upper.value ||
      (lower.value === upper.value && (lower.exclusive || upper.exclusive)))
  ) {
    throw new UnsupportedSchemaError(path, "no number satisfies its bounds");
  }
  return fc.double({
    min: lower?.value ?? -Number.MAX_VALUE,
    minExcluded: lower?.exclusive ?? false,
    max: upper?.value ?? Number.MAX_VALUE,
    maxExcluded: upper?.exclusive ?? false,
    noNaN: true,
    noDefaultInfinity: true,
  });
}

interface Bound {
  value: number;
  exclusive: boolean;
}

function lowerBound(schema: JsonObject, path: string): Bound | undefined {
  let bound: Bound | undefined;
  for (const [keyword, exclusive] of [
    ["minimum", false],
    ["exclusiveMinimum", true],
  ] as const) {
    const value = numberKeyword(schema, keyword, path);
    if (value === undefined) continue;
    if (!bound || value > bound.value || (value === bound.value && exclusive)) {
      bound = { value, exclusive };
    }
  }
  return bound;
}

function upperBound(schema: JsonObject, path: string): Bound | undefined {
  let bound: Bound | undefined;
  for (const [keyword, exclusive] of [
    ["maximum", false],
    ["exclusiveMaximum", true],
  ] as const) {
    const value = numberKeyword(schema, keyword, path);
    if (value === undefined) continue;
    if (!bound || value < bound.value || (value === bound.value && exclusive)) {
      bound = { value, exclusive };
    }
  }
  return bound;
}

function numberKeyword(
  schema: JsonObject,
  keyword: string,
  path: string,
): number | undefined {
  const value = schema[keyword];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new UnsupportedSchemaError(
      path,
      `${keyword} must be a finite number`,
    );
  }
  return value;
}

function arrayArbitrary(
  schema: JsonObject,
  path: string,
  overrides: ArbitraryOverrides,
): fc.Arbitrary<unknown[]> {
  const minLength = nonNegativeInteger(schema, "minItems", path) ?? 0;
  const maxLength = nonNegativeInteger(schema, "maxItems", path);
  const items = arbitraryAt(schema.items, `${path}/-`, overrides);
  return fc.array(items, {
    minLength,
    ...(maxLength === undefined ? {} : { maxLength }),
  });
}

function objectArbitrary(
  schema: JsonObject,
  path: string,
  overrides: ArbitraryOverrides,
): fc.Arbitrary<JsonObject> {
  if (
    schema.additionalProperties !== undefined &&
    schema.additionalProperties !== false
  ) {
    throw new UnsupportedSchemaError(
      path,
      "additionalProperties must be false or omitted",
    );
  }
  if (
    schema.properties === undefined &&
    schema.additionalProperties !== false
  ) {
    throw new UnsupportedSchemaError(path, "the object accepts any keys");
  }
  const properties = schema.properties ?? {};
  if (!isJsonObject(properties)) {
    throw new UnsupportedSchemaError(path, "properties must be an object");
  }
  const required = schema.required ?? [];
  if (
    !Array.isArray(required) ||
    !required.every((key) => typeof key === "string")
  ) {
    throw new UnsupportedSchemaError(path, "required must be a list of names");
  }
  for (const key of required as string[]) {
    if (!Object.hasOwn(properties, key)) {
      throw new UnsupportedSchemaError(
        path,
        `required "${key}" has no property schema`,
      );
    }
  }
  const model: Record<string, fc.Arbitrary<unknown>> = {};
  for (const key of Object.keys(properties)) {
    model[key] = arbitraryAt(
      properties[key],
      `${path}/${escapePointerToken(key)}`,
      overrides,
    );
  }
  return fc.record(model, { requiredKeys: required as string[] });
}

function nonNegativeInteger(
  schema: JsonObject,
  keyword: string,
  path: string,
): number | undefined {
  const value = schema[keyword];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new UnsupportedSchemaError(
      path,
      `${keyword} must be a non-negative integer`,
    );
  }
  return value;
}

function escapePointerToken(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface CheckActionPropertiesOptions {
  /** Generated inputs per property. Defaults to 50. */
  runs?: number;
  /** Replays a run: fast-check reports the seed of any failure. */
  seed?: number;
  /** Passed to every call, copied per call, as the caller would supply it. */
  context: ActionRunContext;
  /** Arbitraries for JSON pointers the generator cannot build. */
  overrides?: ArbitraryOverrides;
}

/** An action defined with `defineAction`. Its zod `schema` is kept on the entry at runtime. */
export type CheckableAction = ActionDefinition<any, any> & {
  readonly schema?: StandardSchemaV1;
};

/**
 * Check an action against inputs generated from its zod schema. Valid inputs
 * must return a value matching `outputSchema`, or throw an action contract
 * error. Invalid inputs (each required property removed, each property set to
 * a wrong-type value) must be rejected by input validation before the handler
 * runs. Rejects with fast-check's shrunk counterexample and seed on failure.
 */
export async function checkActionProperties(
  action: CheckableAction,
  options: CheckActionPropertiesOptions,
): Promise<void> {
  const schema = action.schema;
  if (!schema || !("~standard" in schema)) {
    throw new TypeError(
      "checkActionProperties needs an action defined with a zod `schema`; this action has none.",
    );
  }
  const jsonSchema = inputJsonSchema(schema);
  const inputs = arbitraryFromJsonSchema(jsonSchema, {
    overrides: options.overrides,
  });
  // The report carries the thrown error only when asked: without it the
  // reason for a failure sits in `cause`, and the message names no reason.
  const params = {
    numRuns: options.runs ?? 50,
    seed: options.seed,
    includeErrorInReport: true,
  };
  const outputSchema = action.outputSchema;
  const { entry, counter } = countingEntry(action);

  await fc.assert(
    fc.asyncProperty(inputs, async (input) => {
      await requireSchemaAccepts(schema, input);
      const { result } = await invoke(entry, input, options.context);
      if (result.ok) {
        if (outputSchema)
          await requireOutputMatches(outputSchema, result.value);
        return;
      }
      if (!isActionContractError(result.error)) {
        throw new Error(
          `${describeAction(action)} threw ${describeThrown(result.error)}, which is neither a returned value nor an action contract error. Throw fail(...) for an expected refusal.`,
          { cause: result.error },
        );
      }
      if (isActionOutputContractError(result.error)) {
        throw new Error(
          `${describeAction(action)} returned a value its outputSchema rejects: ${result.error.message}`,
          { cause: result.error },
        );
      }
    }),
    params,
  );

  await fc.assert(
    fc.asyncProperty(inputs, async (valid) => {
      for (const invalid of invalidInputs(jsonSchema, valid)) {
        await requireSchemaRejects(schema, invalid.input, invalid.label);
        const before = counter.runs;
        const { outcome, result } = await invoke(
          entry,
          invalid.input,
          options.context,
        );
        if (counter.runs - before !== 1) {
          throw new Error(
            `${invalid.label}: the call did not reach the action's entry point.`,
          );
        }
        if (result.ok) {
          throw new Error(
            `${invalid.label}: the action ran and returned a value, so input validation did not reject it.`,
          );
        }
        if (!(result.error instanceof ActionInputValidationError)) {
          throw new Error(
            `${invalid.label}: expected input validation to reject the call, got ${describeThrown(result.error)}.`,
            { cause: result.error },
          );
        }
        if (outcome.refused !== true) {
          throw new Error(
            `${invalid.label}: validation rejected the call, but the framework did not confirm the handler was never entered.`,
          );
        }
      }
    }),
    params,
  );
}

function inputJsonSchema(schema: StandardSchemaV1): JsonObject {
  try {
    return z.toJSONSchema(schema as z.ZodType, { io: "input" }) as JsonObject;
  } catch (error) {
    throw new UnsupportedSchemaError(
      "",
      `zod could not convert the input schema to JSON Schema (${describeThrown(error)})`,
    );
  }
}

function countingEntry(action: CheckableAction): {
  entry: CheckableAction;
  counter: { runs: number };
} {
  const counter = { runs: 0 };
  const entry: CheckableAction = {
    ...action,
    run: (args, ctx) => {
      counter.runs += 1;
      return action.run(args, ctx);
    },
  };
  return { entry, counter };
}

type Invocation = { ok: true; value: unknown } | { ok: false; error: unknown };

async function invoke(
  entry: CheckableAction,
  input: unknown,
  context: ActionRunContext,
): Promise<{ outcome: ActionExecutionOutcome; result: Invocation }> {
  const outcome: ActionExecutionOutcome = { refused: false };
  try {
    const value = await runActionWithExecutionOutcome(
      entry.run as ActionExecutionRun,
      input,
      { ...context },
      outcome,
      entry,
    );
    return { outcome, result: { ok: true, value } };
  } catch (error) {
    return { outcome, result: { ok: false, error } };
  }
}

async function requireSchemaAccepts(
  schema: StandardSchemaV1,
  input: unknown,
): Promise<void> {
  const result = await schema["~standard"].validate(input);
  if (result.issues) {
    throw new Error(
      `The generator produced an input the action's schema rejects (${formatIssues(result.issues)}). The JSON Schema conversion is looser than the schema.`,
    );
  }
}

async function requireSchemaRejects(
  schema: StandardSchemaV1,
  input: unknown,
  label: string,
): Promise<void> {
  const result = await schema["~standard"].validate(input);
  if (!result.issues) {
    throw new Error(
      `${label} is marked invalid, but the action's schema accepts it, so this case proves nothing. The schema is looser than its JSON Schema, for example a z.coerce schema.`,
    );
  }
}

async function requireOutputMatches(
  outputSchema: StandardSchemaV1,
  value: unknown,
): Promise<void> {
  const result = await outputSchema["~standard"].validate(value);
  if (result.issues) {
    throw new Error(
      `returned a value that does not match its outputSchema: ${formatIssues(result.issues)}`,
    );
  }
}

function formatIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) =>
          typeof segment === "object" ? String(segment.key) : String(segment),
        )
        .join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function describeAction(action: CheckableAction): string {
  return `The action "${action.tool.description}"`;
}

function describeThrown(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : `a non-Error value (${String(error)})`;
}

interface InvalidInput {
  label: string;
  input: unknown;
}

function invalidInputs(schema: JsonObject, valid: unknown): InvalidInput[] {
  const cases: InvalidInput[] = [];
  const wrongRoot = wrongValueFor(schema, "the input");
  cases.push({
    label: `input set to ${JSON.stringify(wrongRoot)}`,
    input: wrongRoot,
  });
  if (schema.type === "object" && isJsonObject(valid)) {
    const properties = isJsonObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? (schema.required as string[])
      : [];
    for (const key of required) {
      const copy = structuredClone(valid);
      delete copy[key];
      cases.push({ label: `required "${key}" removed`, input: copy });
    }
    for (const key of Object.keys(properties)) {
      const wrong = wrongValueFor(properties[key], `property "${key}"`);
      cases.push({
        label: `"${key}" set to ${JSON.stringify(wrong)}`,
        input: { ...structuredClone(valid), [key]: wrong },
      });
    }
  }
  return cases;
}

// A value whose JSON kind is not admitted cannot satisfy the schema, however
// its format or length is constrained, so the first unadmitted kind wins.
const WRONG_VALUES: ReadonlyArray<readonly [JsonKind, unknown]> = [
  ["string", "not-a-valid-value"],
  ["number", 1234567],
  ["boolean", true],
  ["null", null],
  ["array", []],
  ["object", {}],
];

function wrongValueFor(schema: unknown, what: string): unknown {
  const admitted = admittedKinds(schema, what);
  const found = WRONG_VALUES.find(([kind]) => !admitted.has(kind));
  if (!found) {
    throw new Error(
      `Cannot find a wrong-type value for ${what}: its schema admits every JSON kind.`,
    );
  }
  return found[1];
}

function admittedKinds(schema: unknown, what: string): Set<JsonKind> {
  if (!isJsonObject(schema)) {
    throw new Error(
      `Cannot find a wrong-type value for ${what}: its schema is not an object.`,
    );
  }
  if (Object.hasOwn(schema, "const")) return new Set([kindOf(schema.const)]);
  if (Object.hasOwn(schema, "enum")) {
    return new Set((schema.enum as unknown[]).map(kindOf));
  }
  const branches = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(branches)) {
    const kinds = new Set<JsonKind>();
    for (const branch of branches) {
      for (const kind of admittedKinds(branch, what)) kinds.add(kind);
    }
    return kinds;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return new Set(
    types.map((type): JsonKind => {
      if (type === "integer") return "number";
      if (type === "string" || type === "number" || type === "boolean")
        return type;
      if (type === "null" || type === "array" || type === "object") return type;
      throw new Error(
        `Cannot find a wrong-type value for ${what}: type ${String(type)} is unknown.`,
      );
    }),
  );
}

function kindOf(value: unknown): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  return "object";
}
