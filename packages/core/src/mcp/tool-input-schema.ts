import type { Tool } from "@modelcontextprotocol/server";

import { stripUnsupportedSchemaKeywords } from "../action.js";
import { flattenComposedRootSchema } from "../agent/engine/flatten-composed-root-schema.js";
import {
  isBoundedJsonValueBranches,
  recursiveJsonValueDefinition,
} from "../json-schema/json-value.js";
import { unresolvedLocalRefs } from "../json-schema/local-refs.js";
import {
  isJsonSchemaObject,
  rewriteSubschemas,
  walkSubschemas,
  type JsonSchema,
} from "../json-schema/subschemas.js";
import {
  plainJsonSnapshot,
  UnusableSchemaError,
} from "../json-schema/unusable-schema.js";
import { assertUsableSchema } from "../json-schema/usable-schema.js";

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
 * - The schema is read once, into a plain copy that every later step reads
 *   (`plainJsonSnapshot`), so what is checked is what is advertised.
 * - Every reference is checked against the source and made a plain pointer
 *   before anything is rewritten; one that does not resolve throws instead of
 *   vanishing with the branch that held it. References that point inside a
 *   composition move into root `$defs`.
 * - `stripUnsupportedSchemaKeywords` removes the keywords providers reject,
 *   and moves an enum that lists anything but strings into the description.
 *   A position with no type, including the bounded stand-in the action layer
 *   already wrote, references one recursive "any JSON value" definition.
 * - A root anyOf/oneOf/allOf is flattened; Anthropic rejects one. An empty
 *   `anyOf` or `oneOf` accepts no value, which no flattened object can say,
 *   so one anywhere throws, and so does a root no object satisfies.
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
  let source: JsonSchema;
  try {
    source = assertUsableSchema(plainJsonSnapshot(schema));
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
