type JsonSchema = Record<string, unknown>;

const COMPOSITIONS = ["anyOf", "oneOf", "allOf"] as const;

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
    if (!Array.isArray(raw) || raw.length === 0) continue;
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
