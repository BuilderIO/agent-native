import { boundedJsonValueBranches } from "../../json-schema/json-value.js";
import {
  rebaseLocalRefs,
  resolveLocalRef,
  SchemaReferenceError,
} from "../../json-schema/local-refs.js";
import {
  isJsonSchemaObject as isSchema,
  type JsonSchema,
} from "../../json-schema/subschemas.js";

const COMPOSITIONS = ["anyOf", "oneOf", "allOf"] as const;

/**
 * What an object view allows for one key's value. `never` means the key is
 * not allowed; `any` means any value, with `hints` naming the shapes some
 * branch declared so the model still sees them.
 */
type Side =
  | { kind: "never" }
  | { kind: "any"; hints: JsonSchema[] }
  | { kind: "schema"; schema: JsonSchema };

const NEVER: Side = { kind: "never" };
const ANY: Side = { kind: "any", hints: [] };

/**
 * Object-level keywords that hold independently of which keys are declared,
 * so an allOf can keep every branch's and an anyOf can keep the ones all
 * branches share.
 */
interface Constraints {
  patternProperties?: JsonSchema;
  propertyNames?: unknown;
  minProperties?: number;
  maxProperties?: number;
}

/**
 * An over-approximation of the objects one schema accepts: each declared key
 * is checked against its side, every other key against `extra`. `null` is the
 * empty view (the schema admits no object).
 */
interface ObjectView {
  properties: Map<string, Side>;
  extra: Side;
  required: Set<string>;
  constraints: Constraints;
}

const TOP: ObjectView = {
  properties: new Map(),
  extra: ANY,
  required: new Set(),
  constraints: {},
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The branches of a bare nested anyOf/allOf that `combine` can splice into
 * its own list. Only the boolean that cannot change the result is left out
 * (`false` in an anyOf, `true` in an allOf); any other branch that is not a
 * schema object keeps the nested composition whole, because `true` in an
 * anyOf and `false` in an allOf decide it.
 */
function variantsOf(schema: JsonSchema, keyword: "anyOf" | "allOf") {
  if (Object.keys(schema).length !== 1 || !Array.isArray(schema[keyword])) {
    return [schema];
  }
  const neutral = keyword === "allOf";
  const branches = (schema[keyword] as unknown[]).filter(
    (branch) => branch !== neutral,
  );
  return branches.length > 0 && branches.every(isSchema) ? branches : [schema];
}

function combine(
  schemas: JsonSchema[],
  keyword: "anyOf" | "allOf",
): JsonSchema {
  const variants: JsonSchema[] = [];
  for (const schema of schemas) {
    for (const variant of variantsOf(schema, keyword)) {
      if (!variants.some((known) => same(known, variant))) {
        variants.push(variant);
      }
    }
  }
  if (variants.length === 1) return variants[0]!;
  return { [keyword]: variants };
}

/**
 * The allOf of subschema positions: `false` anywhere admits nothing and
 * `true` adds nothing. A value that is not a schema at all constrains
 * nothing a validator could enforce, so it widens to `true` rather than
 * being dropped from a conjunction that `false` would otherwise decide.
 */
function conjoinSubschemas(values: unknown[]): unknown {
  if (values.some((value) => value === false)) return false;
  const schemas = values.filter(isSchema);
  return schemas.length === 0 ? true : combine(schemas, "allOf");
}

/** `false` admits nothing; `true`, `{}` and a non-schema admit anything. */
function sideOf(value: unknown): Side {
  if (value === false) return NEVER;
  if (!isSchema(value) || Object.keys(value).length === 0) return ANY;
  return { kind: "schema", schema: value };
}

function conjoinSides(sides: Side[]): Side {
  if (sides.some((side) => side.kind === "never")) return NEVER;
  const schemas = sides.flatMap((side) =>
    side.kind === "schema" ? [side.schema] : [],
  );
  if (schemas.length > 0) {
    return { kind: "schema", schema: combine(schemas, "allOf") };
  }
  return {
    kind: "any",
    hints: sides.flatMap((side) => (side.kind === "any" ? side.hints : [])),
  };
}

function disjoinSides(sides: Side[]): Side {
  const allowed = sides.filter((side) => side.kind !== "never");
  if (allowed.length === 0) return NEVER;
  const schemas = allowed.flatMap((side) =>
    side.kind === "schema" ? [side.schema] : [],
  );
  if (allowed.some((side) => side.kind === "any")) {
    const hints = [
      ...schemas,
      ...allowed.flatMap((side) => (side.kind === "any" ? side.hints : [])),
    ];
    return { kind: "any", hints };
  }
  return { kind: "schema", schema: combine(schemas, "anyOf") };
}

function sideFor(view: ObjectView, key: string): Side {
  return view.properties.get(key) ?? view.extra;
}

function keysOf(views: ObjectView[]): string[] {
  return [...new Set(views.flatMap((view) => [...view.properties.keys()]))];
}

function conjoinConstraints(views: ObjectView[]): Constraints {
  const pick = <K extends keyof Constraints>(key: K) =>
    views.flatMap((view) =>
      view.constraints[key] === undefined ? [] : [view.constraints[key]!],
    );
  const patterns = pick("patternProperties") as JsonSchema[];
  const names = pick("propertyNames");
  const mins = pick("minProperties") as number[];
  const maxes = pick("maxProperties") as number[];
  const byPattern = new Map<string, unknown[]>();
  for (const map of patterns) {
    for (const [pattern, schema] of Object.entries(map)) {
      byPattern.set(pattern, [...(byPattern.get(pattern) ?? []), schema]);
    }
  }
  const propertyNames = names.length === 0 ? true : conjoinSubschemas(names);
  return {
    patternProperties:
      patterns.length > 0
        ? Object.fromEntries(
            [...byPattern].map(([pattern, schemas]) => [
              pattern,
              conjoinSubschemas(schemas),
            ]),
          )
        : undefined,
    propertyNames: propertyNames === true ? undefined : propertyNames,
    minProperties: mins.length > 0 ? Math.max(...mins) : undefined,
    maxProperties: maxes.length > 0 ? Math.min(...maxes) : undefined,
  };
}

function disjoinConstraints(views: ObjectView[]): Constraints {
  const shared = <K extends keyof Constraints>(key: K) => {
    const first = views[0]?.constraints[key];
    return views.every((view) => same(view.constraints[key], first))
      ? first
      : undefined;
  };
  return {
    patternProperties: shared("patternProperties"),
    propertyNames: shared("propertyNames"),
    minProperties: shared("minProperties"),
    maxProperties: shared("maxProperties"),
  };
}

function conjoin(views: (ObjectView | null)[]): ObjectView | null {
  if (views.some((view) => view === null)) return null;
  const parts = views as ObjectView[];
  if (parts.length === 1) return parts[0]!;
  return {
    properties: new Map(
      keysOf(parts).map((key) => [
        key,
        conjoinSides(parts.map((view) => sideFor(view, key))),
      ]),
    ),
    extra: conjoinSides(parts.map((view) => view.extra)),
    required: new Set(parts.flatMap((view) => [...view.required])),
    constraints: conjoinConstraints(parts),
  };
}

function disjoin(views: (ObjectView | null)[]): ObjectView | null {
  const parts = views.filter((view): view is ObjectView => view !== null);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return {
    properties: new Map(
      keysOf(parts).map((key) => [
        key,
        disjoinSides(parts.map((view) => sideFor(view, key))),
      ]),
    ),
    extra: disjoinSides(parts.map((view) => view.extra)),
    required: new Set(
      [...parts[0]!.required].filter((key) =>
        parts.every((view) => view.required.has(key)),
      ),
    ),
    constraints: disjoinConstraints(parts),
  };
}

function admitsObjects(schema: JsonSchema): boolean {
  const { type } = schema;
  if (type === undefined) return true;
  if (Array.isArray(type)) return type.includes("object");
  return type === "object";
}

/**
 * The view of the keywords on `schema` itself, ignoring its compositions.
 * `patternProperties` exempts matching keys from `additionalProperties`, and
 * a view cannot say which keys match, so a node with patterns leaves every
 * undeclared key open and carries the patterns as a constraint instead.
 */
function ownView(schema: JsonSchema): ObjectView {
  const properties = new Map<string, Side>();
  if (isSchema(schema.properties)) {
    for (const [key, value] of Object.entries(schema.properties)) {
      properties.set(key, sideOf(value));
    }
  }
  const patternProperties = isSchema(schema.patternProperties)
    ? schema.patternProperties
    : undefined;
  return {
    properties,
    extra: patternProperties ? ANY : sideOf(schema.additionalProperties),
    required: new Set(
      Array.isArray(schema.required)
        ? schema.required.filter(
            (key): key is string => typeof key === "string",
          )
        : [],
    ),
    constraints: {
      patternProperties,
      propertyNames: schema.propertyNames,
      minProperties:
        typeof schema.minProperties === "number"
          ? schema.minProperties
          : undefined,
      maxProperties:
        typeof schema.maxProperties === "number"
          ? schema.maxProperties
          : undefined,
    },
  };
}

/**
 * The object view of a branch: its own keywords conjoined with its `$ref`
 * target and nested compositions. `true` is the full view and `false` the
 * empty one; a value that is not a schema widens to the full view. Keywords
 * the view cannot express (`not`, `if`, `dependentRequired`, ...) are
 * dropped, which only widens it. A reference cycle adds nothing past its
 * first visit. A reference with no target throws: treating it as
 * unconstrained would turn a schema no validator compiles into a clean one
 * once its branch is flattened away.
 */
function viewOf(
  value: unknown,
  root: JsonSchema,
  refs: Set<string>,
): ObjectView | null {
  if (value === false) return null;
  if (!isSchema(value)) return TOP;
  if (!admitsObjects(value)) return null;
  const parts: (ObjectView | null)[] = [ownView(value)];
  if (typeof value.$ref === "string" && !refs.has(value.$ref)) {
    const target = resolveLocalRef(root, value.$ref);
    if (typeof target !== "boolean" && !isSchema(target)) {
      throw new SchemaReferenceError(
        "",
        `references ${JSON.stringify(value.$ref)}, which does not resolve`,
      );
    }
    parts.push(viewOf(target, root, new Set(refs).add(value.$ref)));
  }
  for (const keyword of COMPOSITIONS) {
    const branches = value[keyword];
    if (!Array.isArray(branches) || branches.length === 0) continue;
    const views = branches.map((branch) => viewOf(branch, root, refs));
    parts.push(keyword === "allOf" ? conjoin(views) : disjoin(views));
  }
  return conjoin(parts);
}

function quoted(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

/**
 * One line per root anyOf/oneOf branch naming its fixed values and required
 * fields. Flattening keeps every branch's fields but loses which ones go
 * together, so the guidance moves into the description the model reads.
 * A branch that admits no object is left out. One that admits objects but
 * names nothing to pass (`true`, or no fixed or required field) means any
 * set will do, so the description then lists none rather than imply that
 * the others are the only choices.
 */
function argumentSetGuidance(branches: unknown[]): string | undefined {
  const lines: string[] = [];
  for (const branch of branches) {
    if (branch === false) continue;
    if (!isSchema(branch)) return undefined;
    if (!admitsObjects(branch)) continue;
    const properties = isSchema(branch.properties) ? branch.properties : {};
    const fixed: string[] = [];
    for (const [key, schema] of Object.entries(properties)) {
      if (!isSchema(schema)) continue;
      if (schema.const !== undefined) {
        fixed.push(`${key}=${quoted(schema.const)}`);
      } else if (Array.isArray(schema.enum) && schema.enum.length === 1) {
        fixed.push(`${key}=${quoted(schema.enum[0])}`);
      }
    }
    const fixedKeys = new Set(fixed.map((entry) => entry.split("=")[0]));
    const required = (
      Array.isArray(branch.required) ? branch.required : []
    ).filter(
      (key): key is string => typeof key === "string" && !fixedKeys.has(key),
    );
    if (fixed.length === 0 && required.length === 0) return undefined;
    const parts = [
      ...(fixed.length > 0 ? [fixed.join(", ")] : []),
      ...(required.length > 0 ? [`requires ${required.join(", ")}`] : []),
    ];
    lines.push(`- ${parts.join(": ")}`);
  }
  if (lines.length < 2) return undefined;
  return `Pass one of these argument sets:\n${lines.join("\n")}`;
}

export interface FlattenOptions {
  /**
   * Writes "any JSON value" for a key some open branch leaves unconstrained.
   * Defaults to the bounded union the in-app providers accept.
   */
  anyValue?: () => JsonSchema;
}

function writeSide(side: Side, anyValue: () => JsonSchema): JsonSchema {
  if (side.kind === "schema") return side.schema;
  if (side.kind === "any" && side.hints.length > 0) {
    return combine([...side.hints, anyValue()], "anyOf");
  }
  return anyValue();
}

/**
 * Rewrites a root anyOf/oneOf/allOf into one object schema, because Anthropic
 * rejects a composed root ("input_schema does not support oneOf, allOf, or
 * anyOf at the top level"). The result accepts every object the original
 * accepts and may accept more: a key one open branch leaves unconstrained
 * stays unconstrained, and keywords a flat object cannot express are
 * dropped. That holds only when nothing below the root uses `oneOf`, `not`
 * or `if`: a reference back to the root reads the wider result, and under
 * one of those a wider subschema can reject a value the original accepted.
 * MCP and the in-app path run `stripUnsupportedSchemaKeywords` first, which
 * removes all three.
 *
 * The other exception is the default `anyValue`, which the in-app path uses.
 * It admits no array directly inside an array, so there a key one open
 * branch leaves unconstrained rejects `{ x: [[1]] }`; stripping writes the
 * same bound into every typeless position. Without `$ref` a schema can move
 * that limit deeper but never remove it, and that path has no `$ref`:
 * `@ai-sdk/google` drops it, the Builder gateway's OpenAI validator needs a
 * `type` at every position, and Gemini's OpenAPI `parameters` need `items` on
 * every array. MCP passes the unbounded `$ref` form instead. Callers validate
 * against the action's own schema, not this copy, so the bound only keeps
 * nested arrays out of what the model is offered.
 *
 * Local references into the removed compositions are rebased into root
 * `$defs` first, and a reference that does not resolve throws
 * `SchemaReferenceError`.
 */
export function flattenComposedRootSchema(
  schema: JsonSchema,
  options: FlattenOptions = {},
): JsonSchema {
  if (!COMPOSITIONS.some((key) => key in schema)) return schema;
  const anyValue =
    options.anyValue ?? (() => ({ anyOf: boundedJsonValueBranches() }));
  const root = rebaseLocalRefs(schema);

  const parts: (ObjectView | null)[] = [ownView(root)];
  const guidance: string[] = [];
  for (const keyword of COMPOSITIONS) {
    const branches = root[keyword];
    if (!Array.isArray(branches) || branches.length === 0) continue;
    const views = branches.map((branch) => viewOf(branch, root, new Set()));
    parts.push(keyword === "allOf" ? conjoin(views) : disjoin(views));
    if (keyword !== "allOf") {
      const lines = argumentSetGuidance(branches);
      if (lines) guidance.push(lines);
    }
  }
  const merged = conjoin(parts) ?? TOP;

  const flat: JsonSchema = { ...root };
  for (const key of [
    ...COMPOSITIONS,
    "properties",
    "required",
    "additionalProperties",
    "unevaluatedProperties",
    "patternProperties",
    "propertyNames",
    "minProperties",
    "maxProperties",
  ]) {
    delete flat[key];
  }
  for (const [key, value] of Object.entries(merged.constraints)) {
    if (value !== undefined) flat[key] = value;
  }
  if (merged.extra.kind === "never") flat.additionalProperties = false;
  else if (merged.extra.kind === "schema") {
    flat.additionalProperties = merged.extra.schema;
  }
  if (guidance.length > 0) {
    flat.description = [
      typeof root.description === "string" ? root.description : "",
      ...guidance,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  // Not assignment: a property named `__proto__` would set the prototype.
  const properties = Object.fromEntries(
    [...merged.properties]
      .filter(([, side]) => side.kind !== "never")
      .map(([key, side]) => [key, writeSide(side, anyValue)]),
  );
  return {
    ...flat,
    type: "object",
    properties,
    required: [...merged.required],
  };
}
