import { rebaseLocalRefs, resolveLocalRef } from "./local-refs.js";
import { isJsonSchemaObject, type JsonSchema } from "./subschemas.js";
import {
  assertEveryPositionAcceptsAValue,
  UninterpretedSchema,
  UnusableSchemaError,
} from "./unusable-schema.js";

/** Whether `schema`, or the local reference it holds, is object-only. */
export function isObjectOnly(
  schema: unknown,
  root: unknown = schema,
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
  const isObject = (branch: unknown) => isObjectOnly(branch, root, next);
  if (
    (typeof node.$ref === "string" &&
      isObject(resolveLocalRef(root, node.$ref))) ||
    (Array.isArray(node.allOf) && node.allOf.some(isObject))
  ) {
    return true;
  }
  return [node.anyOf, node.oneOf].some(
    (branches) =>
      Array.isArray(branches) &&
      branches.length > 0 &&
      branches.every(isObject),
  );
}

/**
 * False when no object can satisfy `schema`: it is `false`, its type, `const`
 * or `enum` leaves objects out, or one `allOf` branch, its reference's
 * target, or every `anyOf` or `oneOf` branch admits none. Other keywords are
 * not read, so a schema this accepts can still refuse every object, but one it
 * refuses accepts none. It must refuse at least what the flattener does once
 * stripping has typed each `const` and `enum` from its values.
 */
function admitsAnObject(
  schema: unknown,
  root: JsonSchema,
  refs: Set<string> = new Set(),
): boolean {
  if (schema === false) return false;
  if (!isJsonSchemaObject(schema)) return true;
  const { type } = schema;
  if (type !== undefined && ![type].flat().includes("object")) return false;
  if (schema.const !== undefined && !isJsonSchemaObject(schema.const)) {
    return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(isJsonSchemaObject)) {
    return false;
  }
  const admits = (branch: unknown) => admitsAnObject(branch, root, refs);
  if (Array.isArray(schema.allOf) && !schema.allOf.every(admits)) return false;
  for (const branches of [schema.anyOf, schema.oneOf]) {
    if (Array.isArray(branches) && !branches.some(admits)) return false;
  }
  const ref = schema.$ref;
  if (typeof ref !== "string" || refs.has(ref)) return true;
  return admitsAnObject(
    resolveLocalRef(root, ref),
    root,
    new Set(refs).add(ref),
  );
}

const DRAFT_2020_12 = /^https?:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/;

/** Whether the checks read a schema whose `$schema` is `dialect`. */
export function interpretsDialect(dialect: unknown): boolean {
  return (
    dialect === undefined ||
    (typeof dialect === "string" && DRAFT_2020_12.test(dialect))
  );
}

/**
 * The checks every list that offers a tool runs on its input schema, read
 * from a plain copy (`plainJsonSnapshot`) the check may edit: `defineAction`
 * on the source it strips, MCP and the in-app agent on the parameters they
 * convert, and the MCP client on each remote tool. Throws
 * `UnusableSchemaError` for a root that is not an object schema or that no
 * object satisfies, a position no value satisfies, and a reference that does
 * not resolve. Returns the copy with its local references rebased into root
 * `$defs`, so stripping and flattening cannot leave a valid one dangling.
 * A `$schema` other than 2020-12, which MCP assumes when there is none, turns
 * off every check but the object root `main` required: the schema comes back
 * unread, as an `UninterpretedSchema`.
 */
export function assertUsableSchema(snapshot: unknown) {
  const read =
    !isJsonSchemaObject(snapshot) || interpretsDialect(snapshot.$schema);
  const rebased = read
    ? rebaseLocalRefs(snapshot as JsonSchema)
    : (snapshot as JsonSchema);
  if (!isObjectOnly(rebased)) {
    throw new UnusableSchemaError("", "is not an object schema");
  }
  if (!read) {
    const { $schema: dialect, ...schema } = rebased;
    return new UninterpretedSchema(schema, dialect);
  }
  assertEveryPositionAcceptsAValue(rebased);
  if (!admitsAnObject(rebased, rebased)) {
    throw new UnusableSchemaError("", "accepts no object");
  }
  return rebased;
}
