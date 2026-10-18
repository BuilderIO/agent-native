import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Prepared arguments holding a value `encodeActionArguments` cannot encode exactly. */
export class UnsupportedActionArgumentError extends Error {
  /** Where the value sits, as `key.nested[0]`; empty for the arguments themselves. */
  readonly path: string;
  /** What the value is: `Map`, `function`, `circular reference`, and so on. */
  readonly kind: string;

  constructor(path: string, kind: string) {
    super(
      `Argument ${path ? `"${path}"` : "(root)"} has no exact encoding (${kind}).`,
    );
    this.name = "UnsupportedActionArgumentError";
    this.path = path;
    this.kind = kind;
  }
}

/**
 * The exact encoding of the arguments a prepared call runs with. Approval
 * grants and continued-turn replays bind it, so arguments that would run
 * differently never share one: every value is tagged with its type, plain
 * object keys are sorted, an `undefined` property differs from a missing one,
 * and a Date encodes as its ISO time. Any other value (a Map, a class
 * instance, a function, an invalid Date, a cycle) throws
 * `UnsupportedActionArgumentError` rather than encoding approximately.
 */
export function encodeActionArguments(value: unknown): string {
  return encodeValue(value, "", new Set());
}

/** SHA-256 hex of `encodeActionArguments`; throws as it does. */
export function actionArgumentsHash(value: unknown): string {
  return bytesToHex(
    sha256(new TextEncoder().encode(encodeActionArguments(value))),
  );
}

/** `actionArgumentsHash`, or why the arguments have none. */
export function actionArgumentsIdentity(
  value: unknown,
):
  | { readonly ok: true; readonly hash: string }
  | { readonly ok: false; readonly error: UnsupportedActionArgumentError } {
  try {
    return { ok: true, hash: actionArgumentsHash(value) };
  } catch (error) {
    if (error instanceof UnsupportedActionArgumentError) {
      return { ok: false, error };
    }
    throw error;
  }
}

function encodeValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string {
  switch (typeof value) {
    case "undefined":
      return "u";
    case "boolean":
      return value ? "t" : "f";
    case "number":
      return `n${Object.is(value, -0) ? "-0" : String(value)}`;
    case "bigint":
      return `i${String(value)}`;
    case "string":
      return `s${JSON.stringify(value)}`;
    case "object":
      break;
    default:
      throw new UnsupportedActionArgumentError(path, typeof value);
  }
  if (value === null) return "z";
  if (ancestors.has(value)) {
    throw new UnsupportedActionArgumentError(path, "circular reference");
  }
  const prototype = Object.getPrototypeOf(value);
  const ownKeys = Reflect.ownKeys(value);
  if (prototype === Date.prototype && ownKeys.length === 0) {
    const time = (value as Date).getTime();
    if (Number.isNaN(time)) {
      throw new UnsupportedActionArgumentError(path, "invalid Date");
    }
    return `d${(value as Date).toISOString()}`;
  }
  ancestors.add(value);
  try {
    if (prototype === Array.prototype) {
      const items = value as unknown[];
      let present = 0;
      const encoded: string[] = [];
      for (let index = 0; index < items.length; index++) {
        if (!Object.hasOwn(items, index)) {
          encoded.push("_");
          continue;
        }
        present++;
        encoded.push(encodeValue(items[index], `${path}[${index}]`, ancestors));
      }
      // Indices and `length` only: any other property would go unencoded.
      if (ownKeys.length !== present + 1) {
        throw new UnsupportedActionArgumentError(path, "array with properties");
      }
      return `a[${encoded.join(",")}]`;
    }
    if (prototype === Object.prototype || prototype === null) {
      const keys = Object.keys(value);
      // Symbol and non-enumerable keys would go unencoded.
      if (keys.length !== ownKeys.length) {
        throw new UnsupportedActionArgumentError(
          path,
          "object with hidden keys",
        );
      }
      keys.sort();
      return `o{${keys
        .map(
          (key) =>
            `${JSON.stringify(key)}:${encodeValue(
              (value as Record<string, unknown>)[key],
              path ? `${path}.${key}` : key,
              ancestors,
            )}`,
        )
        .join(",")}}`;
    }
  } finally {
    ancestors.delete(value);
  }
  const name: unknown = prototype?.constructor?.name;
  throw new UnsupportedActionArgumentError(
    path,
    typeof name === "string" && name ? name : "object",
  );
}
