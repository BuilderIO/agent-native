export type JsonSchema = Record<string, unknown>;

/** A subschema position: a schema object or the boolean schema forms. */
export type SubschemaValue = JsonSchema | boolean;

/**
 * Every draft 2020-12 (and draft-07) keyword whose value is a subschema, a
 * list of subschemas, or a map of them. A walker that misses one lets a
 * provider-rejected keyword hide in that position, so this list is the single
 * place to add a keyword.
 */
const SINGLE_KEYWORDS = [
  "items",
  "additionalItems",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
] as const;
const LIST_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;
const MAP_KEYWORDS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
] as const;

export function isJsonSchemaObject(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Sets `target[key]` as an own property, the way `JSON.parse` does. Plain
 * assignment of a property named `__proto__` replaces the object's prototype
 * instead, so a schema map built that way loses the property.
 */
export function setOwnProperty(
  target: JsonSchema,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function isSubschema(value: unknown): value is SubschemaValue {
  return typeof value === "boolean" || isJsonSchemaObject(value);
}

export interface SubschemaChild {
  value: SubschemaValue;
  /** JSON-pointer-style path segment(s) from the parent, e.g. `/properties/a`. */
  pointer: string;
  keyword: string;
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** The direct subschemas of one schema node, in a stable order. */
export function subschemasOf(schema: JsonSchema): SubschemaChild[] {
  const children: SubschemaChild[] = [];
  for (const keyword of SINGLE_KEYWORDS) {
    const value = schema[keyword];
    if (isSubschema(value)) {
      children.push({ value, pointer: `/${keyword}`, keyword });
    } else if (keyword === "items" && Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isSubschema(item)) {
          children.push({ value: item, pointer: `/items/${index}`, keyword });
        }
      });
    }
  }
  for (const keyword of LIST_KEYWORDS) {
    const value = schema[keyword];
    if (!Array.isArray(value)) continue;
    value.forEach((item, index) => {
      if (isSubschema(item)) {
        children.push({
          value: item,
          pointer: `/${keyword}/${index}`,
          keyword,
        });
      }
    });
  }
  for (const keyword of MAP_KEYWORDS) {
    const value = schema[keyword];
    if (!isJsonSchemaObject(value)) continue;
    for (const [name, child] of Object.entries(value)) {
      // draft-07 `dependencies` mixes subschemas with required-key lists.
      if (isSubschema(child)) {
        children.push({
          value: child,
          pointer: `/${keyword}/${escapePointer(name)}`,
          keyword,
        });
      }
    }
  }
  return children;
}

/**
 * Replaces subschemas in place, depth first: `rewrite` sees each child and
 * returns what should stand in its position; the result is then descended
 * into. `schema` must be an acyclic tree the caller owns.
 */
export function rewriteSubschemas(
  schema: JsonSchema,
  rewrite: (value: SubschemaValue, keyword: string) => SubschemaValue,
): void {
  for (const keyword of SINGLE_KEYWORDS) {
    const value = schema[keyword];
    if (isSubschema(value)) {
      schema[keyword] = rewrite(value, keyword);
    } else if (keyword === "items" && Array.isArray(value)) {
      schema[keyword] = value.map((item) =>
        isSubschema(item) ? rewrite(item, keyword) : item,
      );
    }
  }
  for (const keyword of LIST_KEYWORDS) {
    const value = schema[keyword];
    if (Array.isArray(value)) {
      schema[keyword] = value.map((item) =>
        isSubschema(item) ? rewrite(item, keyword) : item,
      );
    }
  }
  for (const keyword of MAP_KEYWORDS) {
    const value = schema[keyword];
    if (!isJsonSchemaObject(value)) continue;
    for (const [name, child] of Object.entries(value)) {
      if (isSubschema(child)) {
        setOwnProperty(value, name, rewrite(child, keyword));
      }
    }
  }
  for (const child of subschemasOf(schema)) {
    if (isJsonSchemaObject(child.value)) {
      rewriteSubschemas(child.value, rewrite);
    }
  }
}

/**
 * Visits `schema` and every subschema beneath it, depth first, with the JSON
 * pointer of each position. Value-bearing keywords (`const`, `enum`,
 * `default`, `examples`) are data, not schemas, and are never entered.
 */
export function walkSubschemas(
  schema: SubschemaValue,
  visit: (node: SubschemaValue, pointer: string, keyword?: string) => void,
  pointer = "",
  keyword?: string,
  ancestors = new Set<unknown>(),
): void {
  visit(schema, pointer, keyword);
  if (!isJsonSchemaObject(schema) || ancestors.has(schema)) return;
  const next = new Set(ancestors).add(schema);
  for (const child of subschemasOf(schema)) {
    walkSubschemas(
      child.value,
      visit,
      `${pointer}${child.pointer}`,
      child.keyword,
      next,
    );
  }
}
