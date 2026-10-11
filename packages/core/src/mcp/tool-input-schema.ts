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
export class McpToolSchemaError extends Error {
  constructor(
    readonly tool: string,
    readonly path: string,
    reason: string,
  ) {
    super(
      `MCP tool "${tool}" has an input schema that ${reason} at ${path || "/"}.`,
    );
    this.name = "McpToolSchemaError";
  }
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

function freeDefinitionName(schema: JsonSchema, base: string): string {
  const defs = isJsonSchemaObject(schema.$defs) ? schema.$defs : {};
  let name = base;
  for (let n = 2; name in defs; n++) name = `${base}${n}`;
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
 * - Local references that point inside a composition move into root `$defs`
 *   before anything is rewritten.
 * - `stripUnsupportedSchemaKeywords` removes the keywords providers reject.
 *   A position with no type, including the bounded stand-in the action layer
 *   already wrote, references one recursive "any JSON value" definition.
 * - A root anyOf/oneOf/allOf is flattened; Anthropic rejects one.
 * - Boolean subschemas, and the missing `items` of an array, become that
 *   definition too: Codex lowers both to `{ "type": "string" }`, which would
 *   narrow the contract.
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
  const copy = JSON.parse(JSON.stringify(schema)) as JsonSchema;

  const anyName = freeDefinitionName(copy, "JsonValue");
  const anyRef = `#/$defs/${anyName}`;
  const anyValue = (): JsonSchema => ({ $ref: anyRef });

  let advertised = stripUnsupportedSchemaKeywords(
    rebaseLocalRefs(copy),
    (node) => {
      node.$ref = anyRef;
    },
  );
  rewriteSubschemas(advertised, (value) => {
    if (isJsonSchemaObject(value) && isBoundedJsonValueBranches(value.anyOf)) {
      const { anyOf: _bounded, ...rest } = value;
      return { ...rest, $ref: anyRef };
    }
    return value;
  });
  advertised = flattenComposedRootSchema(advertised, { anyValue });
  rewriteSubschemas(advertised, (value, keyword) =>
    typeof value === "boolean" && keyword !== "additionalProperties"
      ? anyValue()
      : value,
  );
  walkSubschemas(advertised, (node) => {
    if (!isJsonSchemaObject(node) || node.items !== undefined) return;
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (types.includes("array")) node.items = anyValue();
  });
  if (references(advertised, anyRef)) {
    advertised.$defs = {
      ...(isJsonSchemaObject(advertised.$defs) ? advertised.$defs : {}),
      [anyName]: recursiveJsonValueDefinition(anyRef),
    };
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
