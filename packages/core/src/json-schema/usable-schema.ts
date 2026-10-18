import { rebaseLocalRefs, resolveLocalRef } from "./local-refs.js";
import {
  isJsonSchemaObject,
  walkSubschemas,
  type JsonSchema,
} from "./subschemas.js";
import {
  assertEveryPositionAcceptsAValue,
  UnusableSchemaError,
} from "./unusable-schema.js";

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

const DRAFT_04_TO_07 =
  /^(https?:\/\/json-schema\.org\/)?draft-0[467](\/schema#?)?$/;
/** Kept beside such a `$ref`: the definitions references use, and annotations. */
const KEPT_BESIDE_REF =
  /^(\$ref|\$defs|definitions|\$comment|title|description|default|examples|deprecated|readOnly|writeOnly)$/;

/**
 * The checks every list that offers a tool runs on its input schema, read
 * from a plain copy (`plainJsonSnapshot`) the check may edit: `defineAction`
 * on the source it strips, MCP and the in-app agent on the parameters they
 * convert, and the MCP client on each remote tool. Throws
 * `UnusableSchemaError` for a root that is not an object schema or that no
 * object satisfies, a position no value satisfies, and a reference that does
 * not resolve. Returns the copy with its local references rebased into root
 * `$defs`, so stripping and flattening cannot leave a valid one dangling. A
 * draft-04 to draft-07 schema, by `$schema` or else `dialect`, first gets its
 * 2020-12 form, which MCP assumes and the checks read, without the `$schema`
 * it no longer matches: keywords beside `$ref` go, once rebasing has moved out
 * any target inside them, and a tuple's `items` list and `additionalItems`
 * become `prefixItems` and `items`.
 */
export function assertUsableSchema(snapshot: unknown, dialect?: string) {
  const rebased = rebaseLocalRefs(snapshot as JsonSchema);
  const declared = (snapshot as JsonSchema | null)?.$schema ?? dialect;
  if (typeof declared === "string" && DRAFT_04_TO_07.test(declared)) {
    walkSubschemas(rebased, (node) => {
      if (!isJsonSchemaObject(node)) return;
      if (typeof node.$ref === "string") {
        for (const key of Object.keys(node)) {
          if (!KEPT_BESIDE_REF.test(key)) delete node[key];
        }
      } else if (Array.isArray(node.items)) {
        node.prefixItems = node.items;
        if (node.additionalItems === undefined) delete node.items;
        else node.items = node.additionalItems;
      }
      delete node.additionalItems;
    });
    delete rebased.$schema;
  }
  if (!isObjectOnly(rebased)) {
    throw new UnusableSchemaError("", "is not an object schema");
  }
  assertEveryPositionAcceptsAValue(rebased);
  if (!admitsAnObject(rebased, rebased)) {
    throw new UnusableSchemaError("", "accepts no object");
  }
  return rebased;
}
