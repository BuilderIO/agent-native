/**
 * Anthropic rejects a tool whose `input_schema` has `anyOf`, `oneOf` or
 * `allOf` at the top level, and one such tool fails the whole request. A union
 * action schema compiles to exactly that, and deleting the composition would
 * leave the model with the root's (usually empty) `properties`. Flatten it
 * instead: every branch's properties at the root, a property the branches
 * declare differently as an `anyOf` of its variants, and as `required` only
 * what every `anyOf`/`oneOf` branch requires (everything any `allOf` branch
 * requires). The action's own schema still validates the call, so the looser
 * root admits nothing the action would.
 */

type JsonSchema = Record<string, unknown>;

const COMPOSITIONS = ["anyOf", "oneOf", "allOf"] as const;

function isSchema(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredOf(schema: JsonSchema): string[] {
  if (!Array.isArray(schema.required)) return [];
  return schema.required.filter(
    (key): key is string => typeof key === "string",
  );
}

function mergeProperty(current: unknown, next: unknown): unknown {
  if (current === undefined) return next;
  if (JSON.stringify(current) === JSON.stringify(next)) return current;
  const variants =
    isSchema(current) && Array.isArray(current.anyOf)
      ? current.anyOf
      : [current];
  const known = new Set(variants.map((variant) => JSON.stringify(variant)));
  if (known.has(JSON.stringify(next))) return current;
  return { anyOf: [...variants, next] };
}

export function flattenComposedRootSchema(schema: JsonSchema): JsonSchema {
  const compositions = COMPOSITIONS.filter((key) => key in schema);
  if (compositions.length === 0) return schema;

  const root: JsonSchema = { ...schema };
  for (const key of COMPOSITIONS) delete root[key];

  const properties: JsonSchema = isSchema(schema.properties)
    ? { ...schema.properties }
    : {};
  const required = new Set(requiredOf(schema));

  for (const composition of compositions) {
    // A branch that is not an object schema (`true`, `{ type: "null" }`)
    // requires nothing, so it empties an anyOf/oneOf intersection.
    const raw = schema[composition];
    const branches = (Array.isArray(raw) ? raw : []).map((branch) =>
      isSchema(branch) ? flattenComposedRootSchema(branch) : {},
    );
    for (const branch of branches) {
      if (!isSchema(branch.properties)) continue;
      for (const [key, property] of Object.entries(branch.properties)) {
        properties[key] = mergeProperty(properties[key], property);
      }
    }
    const branchRequired = branches.map(requiredOf);
    const kept =
      composition === "allOf"
        ? branchRequired.flat()
        : (branchRequired[0] ?? []).filter((key) =>
            branchRequired.every((keys) => keys.includes(key)),
          );
    for (const key of kept) required.add(key);
  }

  return {
    ...root,
    type: "object",
    properties,
    required: [...required],
  };
}
