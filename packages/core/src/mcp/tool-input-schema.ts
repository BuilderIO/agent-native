import type { Tool } from "@modelcontextprotocol/server";

function isObjectOnly(
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
  // An intersection needs only one object-only constraint; every alternative
  // of a union must require an object before adding the MCP root type is safe.
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
  return { ...(schema as Record<string, unknown>), type: "object" };
}
