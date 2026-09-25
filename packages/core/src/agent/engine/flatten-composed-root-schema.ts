/**
 * Anthropic rejects a tool whose `input_schema` has `anyOf`, `oneOf` or
 * `allOf` at the top level, and one such tool fails the whole request. A union
 * action schema compiles to exactly that, and deleting the composition would
 * leave the model with the root's (usually empty) `properties`. Flatten it
 * instead into one object schema. The root's own keywords and each
 * composition are conjuncts: all of them apply.
 *
 * Within an `anyOf`/`oneOf` (a disjunction; `oneOf`'s exclusivity is not kept):
 * - a property several branches declare differently becomes an `anyOf` of the
 *   declared variants;
 * - `required` keeps only the keys every branch requires;
 * - `additionalProperties: false` holds only if every branch declares it and
 *   every branch has the same `patternProperties`;
 * - `patternProperties`, `propertyNames`, `minProperties` and `maxProperties`
 *   are kept only when every branch has the identical value.
 *
 * Within an `allOf`, and between the root and each composition (conjunctions):
 * - a property declared more than once becomes an `allOf` of its distinct
 *   variants, so every bound still applies;
 * - `required` is the union;
 * - `additionalProperties: false` holds if any conjunct declares it;
 * - `patternProperties` merge by pattern (a repeated pattern's schemas as an
 *   `allOf`), `propertyNames` combine as an `allOf`, `minProperties` takes the
 *   largest value and `maxProperties` the smallest.
 *
 * Nested compositions in a branch are flattened first. Every other branch
 * keyword (`dependentRequired`, `if`/`then`/`else`, `not`,
 * `unevaluatedProperties`, a non-object branch type, ...) cannot be expressed at
 * a flattened root and is dropped. The result is therefore an
 * over-approximation: it admits every input the original admits and may admit
 * some it rejects. The one exception is a property only some `anyOf`/`oneOf`
 * branches declare: it keeps their schemas even though an open branch that
 * omits it would accept any value, which is the guidance the model needs. The
 * provider schema is guidance, not the gate: an action defined with a schema
 * validates its input in `defineAction` before `run`, and an MCP tool is
 * validated by its own server.
 */

type JsonSchema = Record<string, unknown>;

const COMPOSITIONS = ["anyOf", "oneOf", "allOf"] as const;

/** The keywords a flattened object root can carry from its conjuncts. */
interface ObjectPart {
  properties: JsonSchema;
  required: string[];
  closed: boolean;
  patternProperties?: JsonSchema;
  propertyNames?: unknown;
  minProperties?: number;
  maxProperties?: number;
}

function isSchema(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredOf(schema: JsonSchema): string[] {
  if (!Array.isArray(schema.required)) return [];
  return schema.required.filter(
    (key): key is string => typeof key === "string",
  );
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function partOf(schema: JsonSchema): ObjectPart {
  return {
    properties: isSchema(schema.properties) ? schema.properties : {},
    required: requiredOf(schema),
    closed: schema.additionalProperties === false,
    patternProperties: isSchema(schema.patternProperties)
      ? schema.patternProperties
      : undefined,
    propertyNames: schema.propertyNames,
    minProperties: numberOf(schema.minProperties),
    maxProperties: numberOf(schema.maxProperties),
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A schema that is nothing but `{ [keyword]: [...] }` lists its variants. */
function variantsOf(schema: unknown, keyword: "anyOf" | "allOf"): unknown[] {
  if (
    isSchema(schema) &&
    Object.keys(schema).length === 1 &&
    Array.isArray(schema[keyword])
  ) {
    return schema[keyword];
  }
  return [schema];
}

function combine(schemas: unknown[], keyword: "anyOf" | "allOf"): unknown {
  const variants: unknown[] = [];
  for (const schema of schemas) {
    for (const variant of variantsOf(schema, keyword)) {
      // `true` and `{}` admit everything, so a conjunction can skip them.
      if (keyword === "allOf" && (variant === true || same(variant, {}))) {
        continue;
      }
      if (!variants.some((known) => same(known, variant))) {
        variants.push(variant);
      }
    }
  }
  if (variants.length === 0) return {};
  if (variants.length === 1) return variants[0];
  return { [keyword]: variants };
}

function mergeMaps(
  maps: (JsonSchema | undefined)[],
  keyword: "anyOf" | "allOf",
): JsonSchema {
  const grouped = new Map<string, unknown[]>();
  for (const map of maps) {
    for (const [key, schema] of Object.entries(map ?? {})) {
      grouped.set(key, [...(grouped.get(key) ?? []), schema]);
    }
  }
  const merged: JsonSchema = {};
  for (const [key, schemas] of grouped) merged[key] = combine(schemas, keyword);
  return merged;
}

/** The value every part shares, or `undefined` when any part differs. */
function shared<K extends keyof ObjectPart>(
  parts: ObjectPart[],
  key: K,
): ObjectPart[K] | undefined {
  const first = parts[0]?.[key];
  return parts.every((part) => same(part[key], first)) ? first : undefined;
}

function conjoin(parts: ObjectPart[]): ObjectPart {
  const patterns = parts.flatMap((part) =>
    part.patternProperties ? [part.patternProperties] : [],
  );
  const names = parts.flatMap((part) =>
    part.propertyNames === undefined ? [] : [part.propertyNames],
  );
  const mins = parts.flatMap((part) =>
    part.minProperties === undefined ? [] : [part.minProperties],
  );
  const maxes = parts.flatMap((part) =>
    part.maxProperties === undefined ? [] : [part.maxProperties],
  );
  return {
    properties: mergeMaps(
      parts.map((part) => part.properties),
      "allOf",
    ),
    required: [...new Set(parts.flatMap((part) => part.required))],
    closed: parts.some((part) => part.closed),
    patternProperties:
      patterns.length > 0 ? mergeMaps(patterns, "allOf") : undefined,
    propertyNames: names.length > 0 ? combine(names, "allOf") : undefined,
    minProperties: mins.length > 0 ? Math.max(...mins) : undefined,
    maxProperties: maxes.length > 0 ? Math.min(...maxes) : undefined,
  };
}

function disjoin(parts: ObjectPart[]): ObjectPart {
  const samePatterns = parts.every((part) =>
    same(part.patternProperties, parts[0]?.patternProperties),
  );
  return {
    properties: mergeMaps(
      parts.map((part) => part.properties),
      "anyOf",
    ),
    required: (parts[0]?.required ?? []).filter((key) =>
      parts.every((part) => part.required.includes(key)),
    ),
    // Closing is only safe when no branch admits a key through a pattern the
    // flattened root would lose.
    closed: samePatterns && parts.every((part) => part.closed),
    patternProperties: shared(parts, "patternProperties"),
    propertyNames: shared(parts, "propertyNames"),
    minProperties: shared(parts, "minProperties"),
    maxProperties: shared(parts, "maxProperties"),
  };
}

export function flattenComposedRootSchema(schema: JsonSchema): JsonSchema {
  const compositions = COMPOSITIONS.filter((key) => key in schema);
  if (compositions.length === 0) return schema;

  const parts: ObjectPart[] = [partOf(schema)];
  for (const composition of compositions) {
    const raw = schema[composition];
    // An empty composition constrains nothing an over-approximation must keep.
    if (!Array.isArray(raw) || raw.length === 0) continue;
    // A branch that is not an object schema (`true`, `{ type: "null" }`)
    // requires nothing and admits any key, so it loosens a disjunction.
    const branches = raw.map((branch) =>
      partOf(isSchema(branch) ? flattenComposedRootSchema(branch) : {}),
    );
    parts.push(composition === "allOf" ? conjoin(branches) : disjoin(branches));
  }
  const merged = conjoin(parts);

  const root: JsonSchema = { ...schema };
  for (const key of COMPOSITIONS) delete root[key];
  const constraints = {
    patternProperties: merged.patternProperties,
    propertyNames: merged.propertyNames,
    minProperties: merged.minProperties,
    maxProperties: merged.maxProperties,
  };
  for (const [key, value] of Object.entries(constraints)) {
    if (value === undefined) delete root[key];
    else root[key] = value;
  }
  if (merged.closed) root.additionalProperties = false;

  return {
    ...root,
    type: "object",
    properties: merged.properties,
    required: merged.required,
  };
}
