import {
  isJsonSchemaObject,
  setOwnProperty,
  walkSubschemas,
  type JsonSchema,
} from "./subschemas.js";
import { UnusableSchemaError } from "./unusable-schema.js";

const WHOLE_DEFINITION = /^#\/(\$defs|definitions)\/[^/]+$/;

/**
 * A reference the schema rewriters cannot follow. Dropping or skipping it
 * would advertise a contract the source never declared, so callers either
 * refuse the schema or report the tool as unusable.
 */
export class SchemaReferenceError extends UnusableSchemaError {
  constructor(path: string, reason: string) {
    super(path, reason);
    this.name = "SchemaReferenceError";
  }
}

const UNSUPPORTED_REFERENCE_KEYWORDS = ["$dynamicRef", "$recursiveRef"];
const ANCHOR_KEYWORDS = ["$anchor", "$dynamicAnchor"];

/** The canonical `#/...` reference for a pointer's decoded segments. */
function pointerRef(segments: string[]): string {
  return `#${segments
    .map(
      (segment) =>
        `/${segment
          .replace(/~/g, "~0")
          .replace(/\//g, "~1")
          .replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]/gu, (char) =>
            encodeURIComponent(char),
          )}`,
    )
    .join("")}`;
}

/** The decoded segments of a walker pointer such as `/properties/a~1b`. */
function walkSegments(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * The value a pointer's segments name in `root`, or undefined. Only own keys
 * and array indices count: through plain property access `__proto__`,
 * `constructor` or `length` would name something no JSON document holds.
 */
function resolveSegments(root: unknown, segments: string[]): unknown {
  let node: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(node)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined;
      node = node[Number(segment)];
    } else if (isJsonSchemaObject(node)) {
      if (!Object.hasOwn(node, segment)) return undefined;
      node = node[segment];
    } else return undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

function isSchemaTarget(value: unknown): boolean {
  return typeof value === "boolean" || isJsonSchemaObject(value);
}

/** The pointer's segments, or undefined when `ref` is not a local pointer. */
function pointerSegments(ref: string): string[] | undefined {
  if (!ref.startsWith("#")) return undefined;
  let fragment: string;
  try {
    fragment = decodeURIComponent(ref.slice(1));
  } catch (error) {
    // A malformed escape names no target; unresolvedLocalRefs reports it.
    if (error instanceof URIError) return undefined;
    throw error;
  }
  if (fragment === "") return [];
  if (!fragment.startsWith("/")) return undefined;
  return fragment
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** The value a local `#/...` JSON pointer names in `root`, or undefined. */
export function resolveLocalRef(root: unknown, ref: string): unknown {
  const segments = pointerSegments(ref);
  return segments ? resolveSegments(root, segments) : undefined;
}

/**
 * Checks every reference in `schema` against the document and rewrites each
 * one to a plain `#/...` pointer, before anything else touches the schema.
 * The rewriters below match and rebuild references textually, so an
 * equivalent spelling (`#%2F$defs%2FItem`, an `$anchor` name) would survive
 * until its target moved and then dangle, and a reference that never resolved
 * would be dropped along with the composition holding it.
 *
 * Throws `SchemaReferenceError` for a reference that does not resolve here: a
 * missing target, a non-local URI, an `$id` below the root (which re-scopes
 * every reference inside it), or a dynamic reference. Removes `$anchor` and
 * `$dynamicAnchor` once no reference names them, since rebasing copies a
 * target and a duplicated anchor does not compile. Returns `schema` itself
 * when nothing changes; never mutates it.
 */
export function canonicalLocalRefs<T extends object>(schema: T): T {
  const root = schema as JsonSchema;
  const anchors = new Map<string, string>();
  const rewrites = new Map<string, string>();
  let hasAnchors = false;
  walkSubschemas(root, (node, pointer) => {
    if (!isJsonSchemaObject(node)) return;
    if (pointer !== "" && node.$id !== undefined) {
      throw new SchemaReferenceError(
        pointer,
        "declares $id below the root, which changes how the references inside it resolve",
      );
    }
    for (const keyword of UNSUPPORTED_REFERENCE_KEYWORDS) {
      if (node[keyword] !== undefined) {
        throw new SchemaReferenceError(
          pointer,
          `uses ${keyword}, which only a full JSON Schema validator resolves`,
        );
      }
    }
    for (const keyword of ANCHOR_KEYWORDS) {
      const name = node[keyword];
      if (typeof name !== "string") continue;
      hasAnchors = true;
      const ref = pointerRef(walkSegments(pointer));
      const existing = anchors.get(name);
      if (existing !== undefined && existing !== ref) {
        throw new SchemaReferenceError(
          pointer,
          `declares the anchor "${name}" a second time`,
        );
      }
      anchors.set(name, ref);
    }
  });
  walkSubschemas(root, (node, pointer) => {
    if (!isJsonSchemaObject(node) || node.$ref === undefined) return;
    const ref = node.$ref;
    const unresolved = (why: string) =>
      new SchemaReferenceError(
        pointer,
        `references ${JSON.stringify(ref)}, which ${why}`,
      );
    if (typeof ref !== "string" || !ref.startsWith("#")) {
      throw unresolved("is not a reference within this schema");
    }
    let target: string;
    const segments = pointerSegments(ref);
    if (segments) {
      if (!isSchemaTarget(resolveSegments(root, segments))) {
        throw unresolved("does not resolve");
      }
      target = pointerRef(segments);
    } else {
      let name: string;
      try {
        name = decodeURIComponent(ref.slice(1));
      } catch (error) {
        if (error instanceof URIError) throw unresolved("does not resolve");
        throw error;
      }
      const anchored = anchors.get(name);
      if (anchored === undefined) throw unresolved("does not resolve");
      target = anchored;
    }
    if (target !== ref) rewrites.set(ref, target);
  });
  if (rewrites.size === 0 && !hasAnchors) return schema;

  const copy = clone(root);
  walkSubschemas(copy, (node) => {
    if (!isJsonSchemaObject(node)) return;
    if (typeof node.$ref === "string") {
      node.$ref = rewrites.get(node.$ref) ?? node.$ref;
    }
    for (const keyword of ANCHOR_KEYWORDS) delete node[keyword];
  });
  return copy as T;
}

/** Local references whose target does not exist in `root`. */
export function unresolvedLocalRefs(root: JsonSchema): string[] {
  const missing: string[] = [];
  walkSubschemas(root, (node) => {
    if (!isJsonSchemaObject(node) || typeof node.$ref !== "string") return;
    if (!node.$ref.startsWith("#")) return;
    const target = resolveLocalRef(root, node.$ref);
    if (typeof target !== "boolean" && !isJsonSchemaObject(target)) {
      missing.push(node.$ref);
    }
  });
  return missing;
}

function needsRebase(ref: string): boolean {
  return ref.startsWith("#/") && !WHOLE_DEFINITION.test(ref);
}

function definitionName(ref: string, taken: Set<string>): string {
  const base =
    (pointerSegments(ref) ?? [])
      .map((segment) => segment.replace(/[^A-Za-z0-9_]/g, ""))
      .filter(Boolean)
      .join("_") || "ref";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  taken.add(name);
  return name;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Moves every local reference target that is not a whole root definition
 * into root `$defs` and points the reference there. Removing a root
 * composition, or rewriting `oneOf` to `anyOf`, deletes or renumbers the
 * paths a reference like `#/anyOf/0/$defs/Item` names, which turns a valid
 * schema into one no validator can compile. A root `#` reference and
 * `#/$defs/<name>` survive both rewrites, so they are left alone.
 *
 * References are made canonical first, so this throws `SchemaReferenceError`
 * for any `canonicalLocalRefs` refuses. Targets are copied from the original
 * document, and a reference cycle reuses the name already given to that
 * pointer. Returns `schema` itself when nothing changes; never mutates it.
 */
export function rebaseLocalRefs<T extends object>(schema: T): T {
  const canonical = canonicalLocalRefs(schema);
  const root = canonical as JsonSchema;
  let pending = false;
  walkSubschemas(root, (node) => {
    if (
      isJsonSchemaObject(node) &&
      typeof node.$ref === "string" &&
      needsRebase(node.$ref)
    ) {
      pending = true;
    }
  });
  if (!pending) return canonical;

  const copy = clone(root);
  const defs: JsonSchema = isJsonSchemaObject(copy.$defs) ? copy.$defs : {};
  const taken = new Set(Object.keys(defs));
  const names = new Map<string, string>();
  const queue: [string, unknown][] = [];

  const nameFor = (ref: string): string => {
    const known = names.get(ref);
    if (known) return known;
    const name = definitionName(ref, taken);
    names.set(ref, name);
    queue.push([name, clone(resolveLocalRef(root, ref))]);
    return name;
  };
  const rewrite = (schema: unknown) => {
    if (typeof schema !== "boolean" && !isJsonSchemaObject(schema)) return;
    walkSubschemas(schema, (node) => {
      if (
        !isJsonSchemaObject(node) ||
        typeof node.$ref !== "string" ||
        !needsRebase(node.$ref)
      ) {
        return;
      }
      node.$ref = `#/$defs/${nameFor(node.$ref)}`;
    });
  };

  rewrite(copy);
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [name, target] = next;
    rewrite(target);
    setOwnProperty(defs, name, target);
  }
  copy.$defs = defs;
  return copy as T;
}
