import {
  isJsonSchemaObject,
  walkSubschemas,
  type JsonSchema,
} from "./subschemas.js";

const WHOLE_DEFINITION = /^#\/(\$defs|definitions)\/[^/]+$/;

function pointerSegments(ref: string): string[] | undefined {
  if (!ref.startsWith("#")) return undefined;
  let fragment: string;
  try {
    fragment = decodeURIComponent(ref.slice(1));
  } catch {
    return undefined;
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
  if (!segments) return undefined;
  let node: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(node)) node = node[Number(segment)];
    else if (isJsonSchemaObject(node)) node = node[segment];
    else return undefined;
    if (node === undefined) return undefined;
  }
  return node;
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
 * Targets are copied from the original document, and a reference cycle
 * reuses the name already given to that pointer. Returns `root` itself when
 * nothing needs rebasing; never mutates it. Unresolvable references are left
 * for `unresolvedLocalRefs` to report.
 */
export function rebaseLocalRefs<T extends object>(schema: T): T {
  const root = schema as JsonSchema;
  let pending = false;
  walkSubschemas(root, (node) => {
    if (
      isJsonSchemaObject(node) &&
      typeof node.$ref === "string" &&
      needsRebase(node.$ref) &&
      resolveLocalRef(root, node.$ref) !== undefined
    ) {
      pending = true;
    }
  });
  if (!pending) return schema;

  const copy = clone(root);
  const defs: JsonSchema = isJsonSchemaObject(copy.$defs) ? copy.$defs : {};
  const taken = new Set(Object.keys(defs));
  const names = new Map<string, string>();
  const queue: [string, unknown][] = [];

  const nameFor = (ref: string): string | undefined => {
    const known = names.get(ref);
    if (known) return known;
    const target = resolveLocalRef(root, ref);
    if (typeof target !== "boolean" && !isJsonSchemaObject(target)) {
      return undefined;
    }
    const name = definitionName(ref, taken);
    names.set(ref, name);
    queue.push([name, clone(target)]);
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
      const name = nameFor(node.$ref);
      if (name) node.$ref = `#/$defs/${name}`;
    });
  };

  rewrite(copy);
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [name, target] = next;
    rewrite(target);
    defs[name] = target;
  }
  copy.$defs = defs;
  return copy as T;
}
