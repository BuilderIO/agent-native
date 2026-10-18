import type { Tool } from "@modelcontextprotocol/server";

import { stripUnsupportedSchemaKeywords } from "../action.js";
import { flattenComposedRootSchema } from "../agent/engine/flatten-composed-root-schema.js";
import {
  isBoundedJsonValueBranches,
  recursiveJsonValueDefinition,
} from "../json-schema/json-value.js";
import {
  rebaseLocalRefs,
  unresolvedLocalRefs,
} from "../json-schema/local-refs.js";
import {
  isJsonSchemaObject,
  rewriteSubschemas,
  walkSubschemas,
  type JsonSchema,
} from "../json-schema/subschemas.js";
import {
  assertNoEmptyChoices,
  UnusableSchemaError,
} from "../json-schema/unusable-schema.js";

export function isObjectOnly(
  schema: unknown,
  ancestors = new Set<unknown>(),
): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    return false;
  if (ancestors.has(schema)) return false;

  const node = schema as Record<string, unknown>;
  if (node.type === "object") return true;
  if (
    Array.isArray(node.type) &&
    node.type.length === 1 &&
    node.type[0] === "object"
  ) {
    return true;
  }
  if (node.type !== undefined) return false;

  const next = new Set(ancestors).add(schema);
  if (
    Array.isArray(node.allOf) &&
    node.allOf.some((branch) => isObjectOnly(branch, next))
  ) {
    return true;
  }
  return [node.anyOf, node.oneOf].some(
    (branches) =>
      Array.isArray(branches) &&
      branches.length > 0 &&
      branches.every((branch) => isObjectOnly(branch, next)),
  );
}

/** An action's input schema cannot be advertised as written. */
export class McpToolSchemaError extends UnusableSchemaError {
  constructor(
    readonly tool: string,
    path: string,
    reason: string,
  ) {
    super(path, reason);
    this.message = `MCP tool "${tool}" has an input schema that ${reason} at ${path || "/"}.`;
    this.name = "McpToolSchemaError";
  }
}

const advertisability = new WeakMap<object, UnusableSchemaError | null>();

/**
 * Why `mcpToolInputSchema` refuses `schema`, or null when it converts it. Each
 * request decides this for its whole action surface, and converting a large
 * catalog takes tens of milliseconds, so the verdict is kept per schema
 * object. A schema that is not an object is not judged here: `tools/list`
 * still refuses it, as it always has.
 */
export function unadvertisableInputSchema(
  name: string,
  schema: unknown,
): UnusableSchemaError | null {
  if (!isObjectOnly(schema)) return null;
  const known = advertisability.get(schema as object);
  if (known !== undefined) return known;
  let verdict: UnusableSchemaError | null = null;
  try {
    mcpToolInputSchema(name, schema);
  } catch (error) {
    if (!(error instanceof UnusableSchemaError)) throw error;
    verdict = error;
  }
  advertisability.set(schema as object, verdict);
  return verdict;
}

function describeValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (value === undefined) return "undefined";
  if (typeof value === "object" && value !== null) {
    return value.constructor?.name ?? "an object without a prototype";
  }
  return typeof value;
}

/**
 * Throws unless `value` survives a JSON round trip unchanged. `JSON.stringify`
 * turns NaN and Infinity into null and drops functions and undefined, which
 * would advertise a different default or enum than the action declares.
 */
function assertPlainJson(
  tool: string,
  value: unknown,
  path = "",
  ancestors = new Set<object>(),
): void {
  if (value === null || typeof value === "string") return;
  if (typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new McpToolSchemaError(
      tool,
      path,
      `holds ${describeValue(value)}, which JSON cannot represent`,
    );
  }
  if (typeof value !== "object") {
    throw new McpToolSchemaError(
      tool,
      path,
      `holds ${describeValue(value)}, which JSON cannot represent`,
    );
  }
  if (ancestors.has(value)) {
    throw new McpToolSchemaError(tool, path, "refers back to itself");
  }
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      assertPlainJson(tool, value[index], `${path}/${index}`, next);
    }
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new McpToolSchemaError(
      tool,
      path,
      `holds a ${describeValue(value)}, which is not a plain JSON object`,
    );
  }
  for (const [key, child] of Object.entries(value)) {
    const segment = key.replace(/~/g, "~0").replace(/\//g, "~1");
    assertPlainJson(tool, child, `${path}/${segment}`, next);
  }
}

/** JSON equality, where object key order does not matter. */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJsonValue(item, b[index]))
    );
  }
  if (!isJsonSchemaObject(a) || !isJsonSchemaObject(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJsonValue(a[key], b[key]))
  );
}

/**
 * Throws for a `const` its own `enum` does not list. That position accepts no
 * value, and advertising either keyword alone would accept one.
 */
function assertConstInEnum(tool: string, schema: JsonSchema): void {
  walkSubschemas(schema, (node, pointer) => {
    if (!isJsonSchemaObject(node) || node.const === undefined) return;
    if (!Array.isArray(node.enum)) return;
    if (node.enum.some((value) => sameJsonValue(value, node.const))) return;
    throw new McpToolSchemaError(
      tool,
      pointer,
      "declares a const its enum does not list, so it accepts no value",
    );
  });
}

function freeDefinitionName(schema: JsonSchema, base: string): string {
  const defs = isJsonSchemaObject(schema.$defs) ? schema.$defs : {};
  let name = base;
  for (let n = 2; Object.hasOwn(defs, name); n++) name = `${base}${n}`;
  return name;
}

function references(schema: JsonSchema, ref: string): boolean {
  let found = false;
  walkSubschemas(schema, (node) => {
    if (isJsonSchemaObject(node) && node.$ref === ref) found = true;
  });
  return found;
}

/**
 * The input schema an MCP host forwards verbatim to its model provider, where
 * one rejected tool fails every request in the session. Each step only widens
 * what the schema accepts, because the action still validates every call
 * against its own schema and a host that checks arguments against this copy
 * must not refuse a call the action would take:
 *
 * - Every reference is checked against the source and made a plain pointer
 *   before anything is rewritten; one that does not resolve throws instead of
 *   vanishing with the branch that held it. References that point inside a
 *   composition move into root `$defs`.
 * - `stripUnsupportedSchemaKeywords` removes the keywords providers reject.
 *   A position with no type, including the bounded stand-in the action layer
 *   already wrote, references one recursive "any JSON value" definition.
 * - A root anyOf/oneOf/allOf is flattened; Anthropic rejects one. An empty
 *   `anyOf` or `oneOf` accepts no value, which no flattened object can say,
 *   so one anywhere throws.
 * - Boolean subschemas, and the missing `items` of an array, become that
 *   definition too: Codex lowers both to `{ "type": "string" }`, which would
 *   narrow the contract.
 * - `maxItems` moves into the description. Gemini refuses a forced call once
 *   the bound times the item schema is large enough, with no published limit
 *   to stay under: 1,000 strings failed, and so did 100 of Content's property
 *   entries (OpenRouter, 2026-10-17).
 * - A string `const` becomes a one-value `enum`, which means the same thing,
 *   and replaces an `enum` beside it, since only the value both allow is
 *   accepted. A `const` its `enum` does not list accepts nothing and throws,
 *   and so does an empty `enum`, which would otherwise go out with no type.
 *   Gemini's schema has `enum` but no `const`, and a forced call answered
 *   `const: "text"` with "STRING". Number and boolean values stay `const`:
 *   Gemini's OpenAPI `enum` takes strings only.
 */
export function mcpToolInputSchema(
  name: string,
  schema: unknown,
): Tool["inputSchema"] {
  if (schema === undefined) return { type: "object", properties: {} };
  if (!isObjectOnly(schema)) {
    throw new Error(
      `MCP tool "${name}" must declare an object-only input schema; use an object schema or object-only composition.`,
    );
  }
  assertPlainJson(name, schema);
  let source: JsonSchema;
  try {
    assertNoEmptyChoices(schema as JsonSchema);
    assertConstInEnum(name, schema as JsonSchema);
    source = rebaseLocalRefs(JSON.parse(JSON.stringify(schema)) as JsonSchema);
  } catch (error) {
    if (error instanceof UnusableSchemaError) {
      throw new McpToolSchemaError(name, error.path, error.reason);
    }
    throw error;
  }

  const declaresDefs = isJsonSchemaObject(source.$defs);
  const anyName = freeDefinitionName(source, "JsonValue");
  const anyRef = `#/$defs/${anyName}`;
  const anyValue = (): JsonSchema => ({ $ref: anyRef });

  let advertised = stripUnsupportedSchemaKeywords(source, (node) => {
    node.$ref = anyRef;
  });
  rewriteSubschemas(advertised, (value) => {
    if (isJsonSchemaObject(value) && isBoundedJsonValueBranches(value.anyOf)) {
      const { anyOf: _bounded, ...rest } = value;
      return { ...rest, $ref: anyRef };
    }
    return value;
  });
  // Flattening resolves every reference, including the ones written above.
  advertised.$defs = {
    ...(declaresDefs ? (advertised.$defs as JsonSchema) : {}),
    [anyName]: recursiveJsonValueDefinition(anyRef),
  };
  advertised = flattenComposedRootSchema(advertised, { anyValue });
  rewriteSubschemas(advertised, (value, keyword) =>
    typeof value === "boolean" && keyword !== "additionalProperties"
      ? anyValue()
      : value,
  );
  walkSubschemas(advertised, (node) => {
    if (!isJsonSchemaObject(node)) return;
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (node.items === undefined && types.includes("array")) {
      node.items = anyValue();
    }
    if (typeof node.maxItems === "number") {
      const bound = `At most ${node.maxItems} items.`;
      node.description =
        typeof node.description === "string" && node.description
          ? `${node.description} ${bound}`
          : bound;
      delete node.maxItems;
    }
    if (
      typeof node.const === "string" &&
      (node.enum === undefined || Array.isArray(node.enum))
    ) {
      node.enum = [node.const];
      delete node.const;
    }
  });
  const { [anyName]: _anyValue, ...defs } = advertised.$defs as JsonSchema;
  if (!references({ ...advertised, $defs: defs }, anyRef)) {
    if (declaresDefs || Object.keys(defs).length > 0) advertised.$defs = defs;
    else delete advertised.$defs;
  }
  const missing = unresolvedLocalRefs(advertised);
  if (missing.length > 0) {
    throw new McpToolSchemaError(
      name,
      "",
      `references ${missing.join(", ")}, which do not resolve`,
    );
  }
  return { ...advertised, type: "object" } as Tool["inputSchema"];
}
