import type { Tool } from "@modelcontextprotocol/server";

import { stripUnsupportedSchemaKeywords } from "../action.js";
import { flattenComposedRootSchema } from "../agent/engine/flatten-composed-root-schema.js";

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
  let copy: Record<string, unknown>;
  try {
    copy = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `MCP tool "${name}" has an input schema that is not plain JSON, so it cannot be made provider-safe.`,
      { cause: error },
    );
  }
  // Hosts forward this schema verbatim to their model provider, and one tool
  // the provider rejects fails every request in the session. Anthropic rejects
  // a root anyOf/oneOf/allOf; OpenAI rejects oneOf, typeless positions and
  // propertyNames. Callers still validate against the action's own schema, so
  // the advertised copy may be looser but must never be stricter.
  const flattened = flattenComposedRootSchema(
    stripUnsupportedSchemaKeywords(copy),
  );
  return { ...flattened, type: "object" } as Tool["inputSchema"];
}
